const { EventEmitter } = require('events')
const { Readable } = require('stream')
const crypto = require('crypto')

const pump = require('pump')
const MMST = require('mostly-minimal-spanning-tree')

const debug = require('debug')('discovery-swarm-webrtc')
const SignalClient = require('./lib/signal-client')
const Peer = require('./lib/peer')
const Scheduler = require('./lib/scheduler')
const { toHex, toBuffer, SwarmError } = require('./lib/utils')

const ERR_MAX_PEERS_REACHED = 'ERR_MAX_PEERS_REACHED'
const ERR_INVALID_CHANNEL = 'ERR_INVALID_CHANNEL'
const ERR_CONNECTION_DUPLICATED = 'ERR_CONNECTION_DUPLICATED'
const ERR_REMOTE_MAX_PEERS_REACHED = 'ERR_REMOTE_MAX_PEERS_REACHED'
const ERR_REMOTE_INVALID_CHANNEL = 'ERR_REMOTE_INVALID_CHANNEL'
const ERR_REMOTE_CONNECTION_DUPLICATED = 'ERR_REMOTE_CONNECTION_DUPLICATED'

class DiscoverySwarmWebrtc extends EventEmitter {
  constructor (opts = {}) {
    super()
    debug('opts', opts)

    console.assert(Array.isArray(opts.bootstrap) && opts.bootstrap.length > 0, 'An array of bootstrap urls is required.')

    this._id = opts.id || crypto.randomBytes(32)

    this._stream = opts.stream

    this._simplePeerOptions = opts.simplePeerOptions

    this._peers = new Set()

    this._channels = new Set()

    this._mmsts = new Map()

    this._candidates = new Map()

    this._scheduler = new Scheduler()

    this._destroyed = false

    this._maxPeers = opts.maxPeers

    this.signal = new SignalClient({
      bootstrap: opts.bootstrap,
      connectionTimeout: opts.connectionTimeout
    })

    this._initialize(opts)
  }

  get id () {
    return this._id
  }

  get connecting () {
    return this.peers().filter(peer => !peer.connected).length
  }

  get connected () {
    return this.peers().filter(peer => peer.connected).length
  }

  listen () {
    // Empty method to respect the API of discovery-swarm
  }

  peers (channel) {
    console.assert(!channel || Buffer.isBuffer(channel))

    const peers = Array.from(this._peers.values())

    if (channel) {
      return peers.filter(peer => peer.channel.equals(channel))
    }

    return peers
  }

  join (channel) {
    console.assert(Buffer.isBuffer(channel))

    // Account for buffers being passed in
    const channelStr = toHex(channel)
    if (this._channels.has(channelStr)) {
      return
    }

    this._channels.add(channelStr)
    this._candidates.set(channelStr, [])

    const mmst = new MMST({
      id: this._id,
      lookup: () => this._lookup(channelStr),
      connect: (to) => this._connect(to, channelStr),
      maxPeers: this._maxPeers,
      lookupTimeout: 5 * 1000
    })

    this._mmsts.set(channelStr, mmst)

    this._scheduler.addTask(channelStr, async (task) => {
      if (this._isClosed(channel)) {
        return task.destroy()
      }

      if (this.peers(channel).filter(p => p.connected).length > 0) {
        return
      }

      await this._updateCandidates(channel)

      if (this._candidates.get(channelStr).length === 0) {
        return 60 * 1000
      }

      await this._run(channel)
    }, 10 * 1000)

    if (this.signal.connected) {
      this.signal.discover({ id: toHex(this._id), channel: channelStr })
    }
  }

  async leave (channel) {
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
      await this.signal.leave({ id: toHex(this._id), channel: channelStr })
    } catch (err) {
      // Nothing to do.
    }

    await Promise.all(this.peers(channel).map(async peer => this._disconnectPeer(peer)))
  }

  async close () {
    if (this._destroyed) {
      return
    }

    this._destroyed = true

    this._scheduler.clearTasks()
    this._mmsts.forEach(mmst => mmst.destroy())
    this._mmsts.clear()
    this.signal.destroy()
    this._channels.clear()
    this._candidates.clear()
    this._peers.clear()

    return new Promise(resolve => process.nextTick(() => {
      this.emit('close')
      resolve()
    }))
  }

  info (...args) {
    return this.signal.info(...args)
  }

  _initialize () {
    const signal = this.signal

    signal.on('discover', async ({ peers, channel }) => {
      debug('discover', { peers, channel })

      if (this._isClosed(channel)) return

      // Runs mst
      await this._updateCandidates(channel, peers)
      await this._run(channel)
      this._scheduler.startTask(toHex(channel))
    })

    signal.on('request', async (request) => {
      const { initiator: id, metadata: { channel, connectionId } } = request

      try {
        await this._createConnection({ request, id, channel, connectionId })
      } catch (err) {
        // nothing to do
      }
    })

    signal.on('info', data => this.emit('info', data))

    this.signal.on('connect', () => {
      for (let channel of this._channels.keys()) {
        this.signal.discover({ id: toHex(this._id), channel: toHex(channel) })
      }
    })
  }

  async _disconnectPeer (peer) {
    await peer.disconnect()
    this._peers.delete(peer)
  }

  _isClosed (channel) {
    return !this._channels.has(toHex(channel))
  }

  async _createConnection ({ request, id, channel, connectionId }) {
    const peer = new Peer(toBuffer(id), toBuffer(channel), {
      connectionId: connectionId && toBuffer(connectionId),
      initiator: !request
    })

    this._peers.add(peer)

    debug(`createConnection from ${request ? 'request' : 'connect'}`, { request, info: peer.printInfo() })

    let error = null

    try {
      const mmst = this._mmsts.get(toHex(peer.channel))

      if (this._isClosed(peer.channel)) {
        request && request.reject({ code: ERR_REMOTE_INVALID_CHANNEL })
        throw new SwarmError(ERR_INVALID_CHANNEL)
      }

      if (request && !mmst.shouldHandleIncoming()) {
        request && request.reject({ code: ERR_REMOTE_MAX_PEERS_REACHED })
        throw new SwarmError(ERR_MAX_PEERS_REACHED)
      }

      const duplicate = this._checkForDuplicate(peer)
      if (duplicate) {
        request && request.reject({ code: ERR_REMOTE_CONNECTION_DUPLICATED })
        throw new SwarmError(ERR_CONNECTION_DUPLICATED)
      }

      let result = null
      if (request) {
        result = await request.accept({}, this._simplePeerOptions) // Accept the incoming request
      } else {
        result = await this.signal.connect(toHex(peer.id), { channel: toHex(peer.channel), connectionId: toHex(peer.connectionId) }, this._simplePeerOptions)
      }

      peer.connect(result.peer)

      if (this._isClosed(peer.channel)) {
        throw new SwarmError(ERR_INVALID_CHANNEL)
      }

      if (request) {
        if (mmst.shouldHandleIncoming()) {
          mmst.addConnection(peer.id, peer.socket)
        } else {
          throw new SwarmError(ERR_MAX_PEERS_REACHED)
        }
      }

      this._bindSocketEvents(peer)

      return peer
    } catch (err) {
      error = SignalClient.parseMetadataError(err)

      if (error.code === ERR_REMOTE_INVALID_CHANNEL) {
        const candidates = this._candidates.get(toHex(peer.channel))
        this._candidates.set(toHex(peer.channel), candidates.filter(candidate => !candidate.equals(peer.id)))
      }

      this.emit('connect-failed', error, peer.getInfo())
      this.emit('error', error, peer.getInfo())
    }

    await this._disconnectPeer(peer)
    throw error
  }

  _bindSocketEvents (peer) {
    const { socket } = peer
    const info = peer.getInfo()

    socket.on('error', err => {
      debug('error', err)
      this.emit('connection-error', err, info)
    })

    socket.on('connect', () => {
      debug('connect', { peer })
      if (this._isClosed(peer.channel)) {
        peer.disconnect()
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
      debug('close', { peer })

      this._peers.delete(peer)

      socket.emit('end')

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
    if (!peers) {
      if (!this.signal.connected) return
      const result = await this.signal.candidates({ channel: toHex(channel) })
      peers = result.peers
    }

    this._candidates.set(toHex(channel), peers.map(id => toBuffer(id)).filter(id => !id.equals(this._id)))
  }

  async _run (channel) {
    if (!this.signal.connected) return

    try {
      channel = toHex(channel)
      if (this._mmsts.has(channel) && !this._isClosed(channel)) {
        await this._mmsts.get(channel).run()
      }
    } catch (err) {
      // nothing to do
      debug('run error', err.message)
    }
  }

  _lookup (channel) {
    const self = this

    return new Readable({
      read () {
        this.push(self._candidates.get(channel) || [])
        this.push(null)
      },
      objectMode: true
    })
  }

  async _connect (id, channel) {
    const peer = await this._createConnection({ id, channel })
    return peer.socket
  }

  _checkForDuplicate (peer) {
    const oldPeer = this.peers(peer.channel).find(p => p.id.equals(peer.id) && !p.connectionId.equals(peer.connectionId))
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
