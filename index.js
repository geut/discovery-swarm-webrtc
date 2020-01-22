const { EventEmitter } = require('events')
const { Readable } = require('stream')
const crypto = require('crypto')

const pump = require('pump')
const MMST = require('mostly-minimal-spanning-tree')
const debounce = require('p-debounce')

const log = require('debug')('discovery-swarm-webrtc')
const SignalClient = require('./lib/signal-client')
const Peer = require('./lib/peer')
const Scheduler = require('./lib/scheduler')
const { toHex, SwarmError, callbackPromise, resolveCallback } = require('./lib/utils')

const ERR_MAX_PEERS_REACHED = 'ERR_MAX_PEERS_REACHED'
const ERR_INVALID_CHANNEL = 'ERR_INVALID_CHANNEL'
const ERR_CONNECTION_DUPLICATED = 'ERR_CONNECTION_DUPLICATED'
const ERR_REMOTE_MAX_PEERS_REACHED = 'ERR_REMOTE_MAX_PEERS_REACHED'
const ERR_REMOTE_INVALID_CHANNEL = 'ERR_REMOTE_INVALID_CHANNEL'
const ERR_REMOTE_CONNECTION_DUPLICATED = 'ERR_REMOTE_CONNECTION_DUPLICATED'

class DiscoverySwarmWebrtc extends EventEmitter {
  constructor (opts = {}) {
    super()
    log('opts', opts)

    console.assert(Array.isArray(opts.bootstrap) && opts.bootstrap.length > 0, 'The `bootstrap` options is required.')
    console.assert(!opts.id || Buffer.isBuffer(opts.id), 'The `id` option needs to be a Buffer.')

    this._id = opts.id || crypto.randomBytes(32)

    this._stream = opts.stream

    this._simplePeer = opts.simplePeer

    this._peers = new Set()

    this._channels = new Map()

    this._mmsts = new Map()

    this._candidates = new Map()

    this._scheduler = new Scheduler()

    this._destroyed = false

    this._maxPeers = opts.maxPeers

    this.signal = new SignalClient({
      bootstrap: opts.bootstrap,
      connectionTimeout: opts.connectionTimeout || 10 * 1000,
      requestTimeout: opts.requestTimeout || 5 * 1000
    })

    this._updateCandidates = debounce(this._updateCandidates, 500)
    this._initialize(opts)
  }

  get id () {
    return this._id
  }

  get connecting () {
    return this.getPeers().filter(peer => !peer.connected).length
  }

  get connected () {
    return this.getPeers().filter(peer => peer.connected).length
  }

  listen () {
    // Empty method to respect the API of discovery-swarm
  }

  getPeers (channel) {
    console.assert(!channel || Buffer.isBuffer(channel))

    const peers = Array.from(this._peers.values())

    if (channel) {
      return peers.filter(peer => peer.channel.equals(channel))
    }

    return peers
  }

  getCandidates (channel) {
    console.assert(!channel || Buffer.isBuffer(channel))
    return this._candidates.get(toHex(channel)) || { list: [], lastUpdate: 0 }
  }

  join (channel) {
    console.assert(Buffer.isBuffer(channel))

    // Account for buffers being passed in
    const channelStr = toHex(channel)
    if (this._channels.has(channelStr)) {
      return
    }

    this._channels.set(channelStr, channel)

    const mmst = new MMST({
      id: this._id,
      lookup: () => this._lookup(channel),
      connect: (to) => this._createConnection(to, channel),
      maxPeers: this._maxPeers,
      lookupTimeout: 5 * 1000
    })

    this._mmsts.set(channelStr, mmst)

    this._scheduler.addTask(channelStr, async (task) => {
      if (this._isClosed(channel)) return task.destroy()

      await this._run(channel)

      const connected = this.getPeers(channel)
      const { list } = this.getCandidates(channel)
      if (list.length === 0 || connected.length === list.length) return 30 * 1000
    }, 10 * 1000)

    if (this.signal.connected) {
      this.signal.discover(this._id, channel)
    }
  }

  leave (channel, cb = callbackPromise()) {
    resolveCallback(this._leave(channel), cb)
    return cb.promise
  }

  close (cb = callbackPromise()) {
    resolveCallback(this._close(), cb)
    return cb.promise
  }

  info (...args) {
    return this.signal.info(...args)
  }

  async _leave (channel) {
    console.assert(Buffer.isBuffer(channel))

    // Account for buffers being passed in
    const channelStr = toHex(channel)

    this._scheduler.deleteTask(channelStr)
    this._mmsts.get(channelStr).destroy()
    this._mmsts.delete(channelStr)
    this._channels.delete(channelStr)
    this._candidates.delete(channelStr)

    // We need to notify to the signal that we our leaving
    try {
      await this.signal.leave(this._id, channel)
    } catch (err) {
      // Nothing to do.
    }

    await Promise.all(this.getPeers(channel).map(async peer => this._disconnectPeer(peer)))
    this.emit('leave', channel)
  }

  async _close () {
    if (this._destroyed) return
    this._destroyed = true

    await this.signal.disconnect()
    this._scheduler.clearTasks()
    this._mmsts.forEach(mmst => mmst.destroy())
    this._mmsts.clear()
    this._channels.clear()
    this._candidates.clear()

    await Promise.all(this.getPeers().map(async peer => this._disconnectPeer(peer)))

    this.emit('close')
  }

  _initialize () {
    const signal = this.signal

    // It would log the errors and prevent of throw it.
    this.on('error', (...args) => log('error', ...args))

    signal.on('error', err => this.emit('error', err))

    signal.on('discover', async ({ peers, channel }) => {
      log('discover', { channel })

      if (this._isClosed(channel)) return

      await this._updateCandidates(channel, peers)
      await this._run(channel)
      this._scheduler.startTask(toHex(channel))
    })

    signal.on('request', async (request) => {
      const { initiator: id, channel } = request

      try {
        await this._createConnection(id, channel, request)
      } catch (err) {
        // nothing to do
      }
    })

    signal.on('info', data => this.emit('info', data))

    signal.on('connect', () => {
      this._channels.forEach(channel => {
        signal.discover(this._id, channel)
      })
    })
  }

  async _disconnectPeer (peer) {
    await peer.disconnect()
    this._peers.delete(peer)
  }

  _isClosed (channel) {
    return !this._channels.has(toHex(channel))
  }

  async _createConnection (id, channel, request) {
    const peer = new Peer(id, channel, {
      connectionId: request && request.connectionId,
      initiator: !request
    })

    this._peers.add(peer)

    log(`createConnection from ${request ? 'request' : 'connect'}`, { request, info: peer.printInfo() })

    try {
      const mmst = this._getMMST(peer.channel)

      if (this._isClosed(peer.channel)) {
        request && request.reject({ code: ERR_REMOTE_INVALID_CHANNEL })
        throw new SwarmError(ERR_INVALID_CHANNEL)
      }

      if (request && !mmst.shouldHandleIncoming()) {
        request.reject({ code: ERR_REMOTE_MAX_PEERS_REACHED })
        throw new SwarmError(ERR_MAX_PEERS_REACHED)
      }

      const duplicate = this._checkForDuplicate(peer)
      if (duplicate) {
        request && request.reject({ code: ERR_REMOTE_CONNECTION_DUPLICATED })
        throw new SwarmError(ERR_CONNECTION_DUPLICATED)
      }

      let socket = null
      if (request) {
        mmst.addConnection(peer.id, peer)
        socket = await request.accept({}, this._simplePeer) // Accept the incoming request
      } else {
        socket = await this.signal.connect(peer, this._simplePeer)
      }

      await peer.setSocket(socket)

      if (this._isClosed(peer.channel)) {
        throw new SwarmError(ERR_INVALID_CHANNEL)
      }

      this._bindSocketEvents(peer)

      return peer
    } catch (err) {
      if (err.code === ERR_REMOTE_INVALID_CHANNEL) {
        // Remove a candidate.
        const candidates = this.getCandidates(peer.channel)
        candidates.list = candidates.filter(candidate => !candidate.equals(peer.id))
      }

      this.emit('connect-failed', err, peer.getInfo())
      await this._disconnectPeer(peer).catch(err => this.emit('error', err, peer.getInfo()))
      this.emit('error', err, peer.getInfo())
      throw err
    }
  }

  _bindSocketEvents (peer) {
    const { socket } = peer
    const info = peer.getInfo()

    socket.on('error', err => {
      log('error', err)
      this.emit('connection-error', err, info)
    })

    socket.on('connect', () => {
      log('connect', { peer })
      if (this._isClosed(peer.channel)) {
        peer.disconnect()
        return
      }

      if (socket.destroyed) {
        return
      }

      if (!this._stream) {
        this._handleConnection(socket, info)
        return
      }

      const conn = this._stream(info)
      this.emit('handshaking', conn, info)
      conn.on('handshake', this._handshake.bind(this, conn, info))
      pump(socket, conn, socket)
    })

    socket.on('close', () => {
      log('close', { peer })

      this._peers.delete(peer)

      this.emit('connection-closed', socket, info)
    })
  }

  _handshake (conn, info) {
    this._handleConnection(conn, info)
  }

  _handleConnection (conn, info) {
    this.emit('connection', conn, info)
  }

  async _updateCandidates (channel, peers) {
    if (!this.signal.connected) return

    // We try to minimize how many times we get candidates from the signal.
    const { lastUpdate } = this.getCandidates(channel)
    const newUpdate = Date.now()
    if (newUpdate - lastUpdate < 5 * 1000) return

    let list = []
    if (peers) {
      list = peers
    } else {
      list = await this.signal.candidates(this.id, channel)
    }

    list = list.filter(id => !id.equals(this._id))

    this._candidates.set(toHex(channel), { lastUpdate: Date.now(), list })

    this.emit('candidates-updated', channel, list)
  }

  async _run (channel) {
    if (!this.signal.connected) return
    if (this.getPeers(channel).filter(p => p.initiator).length > 0) return

    try {
      if (!this._isClosed(channel)) {
        await this._getMMST(channel).run()
      }
    } catch (err) {
      // nothing to do
      log('run error', err.message)
    }
  }

  _getMMST (channel) {
    return this._mmsts.get(toHex(channel))
  }

  _lookup (channel) {
    const stream = new Readable({
      read () {},
      objectMode: true
    })

    this._updateCandidates(channel).then(() => {
      stream.push(this.getCandidates(channel).list)
      stream.push(null)
    }).catch(() => {
      stream.push(this.getCandidates(channel).list)
      stream.push(null)
    })

    return stream
  }

  _checkForDuplicate (peer) {
    const oldPeer = this.getPeers(peer.channel).find(p => p.id.equals(peer.id) && !p.connectionId.equals(peer.connectionId))
    if (!oldPeer) {
      return
    }

    const connections = [peer, oldPeer]

    /**
     * The first case is to have duplicate connections from the same origin (remote or local).
     * In this case we do a sort by connectionId and destroy the first one.
     */
    if ((peer.initiator && oldPeer.initiator) || (!peer.initiator && !oldPeer.initiator)) {
      return connections.sort((a, b) => Buffer.compare(a.connectionId, b.connectionId))[0]
    }

    /**
     * The second case is to have duplicate connections where each connection is started from different origins.
     * In this case we do a sort by peer id and destroy the first one.
     */
    const toDestroy = [this._id, peer.id].sort(Buffer.compare)[0]
    return connections.find(p => p.id.equals(toDestroy))
  }
}

module.exports = (...args) => new DiscoverySwarmWebrtc(...args)
