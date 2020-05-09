const { EventEmitter } = require('events')
const crypto = require('crypto')
const assert = require('nanocustomassert')

const pump = require('pump')

const log = require('debug')('discovery-swarm-webrtc')
const MMSTSignalClient = require('./lib/mmst-signal-client')
const { toHex, callbackPromise, resolveCallback } = require('./lib/utils')
const errors = require('./lib/errors')

const { ERR_CONNECTION_DUPLICATED } = errors

const assertChannel = channel => assert(Buffer.isBuffer(channel) && channel.length === 32, 'Channel must be a buffer of 32 bytes')

class DiscoverySwarmWebrtc extends EventEmitter {
  constructor (opts = {}) {
    super()
    log('opts', opts)

    const { id = crypto.randomBytes(32), bootstrap, stream, simplePeer, maxPeers = 4, timeout = 10 * 1000, signal } = opts

    assert(Array.isArray(bootstrap) && bootstrap.length > 0, 'The `bootstrap` options is required.')
    assert(Buffer.isBuffer(id) && id.length === 32, 'The `id` option needs to be a Buffer of 32 bytes.')

    this.id = id

    const queueTimeout = timeout * 2

    this.signal = signal || new MMSTSignalClient({
      id: this.id,
      bootstrap,
      mmstOpts: {
        maxPeers,
        queueTimeout, // queue mmst
        lookupTimeout: timeout
      },
      queueTimeout, // socket-signal queue request
      requestTimeout: timeout,
      createConnection: peer => this._createConnection(peer),
      simplePeer,
      reconnectingWebsocket: {
        connectionTimeout: timeout
      }
    })

    this._maxPeers = maxPeers
    this._stream = stream
    this._destroyed = false

    this._initialize(opts)
  }

  get connecting () {
    return this.peersConnecting
  }

  get connected () {
    return this.peers
  }

  listen () {
    // Empty method to respect the API of discovery-swarm
  }

  getPeers (channel) {
    if (channel) return this.signal.getPeersByTopic(channel)
    return this.signal.peers
  }

  join (channel) {
    this.signal.join(channel)
  }

  leave (channel, cb = callbackPromise()) {
    assertChannel(channel)
    resolveCallback(this.signal.leave(channel), cb)
    return cb.promise
  }

  close (cb = callbackPromise()) {
    resolveCallback(this._close(), cb)
    return cb.promise
  }

  async _close () {
    if (this._destroyed) return
    this._destroyed = true
    await this.signal.close()
    this.emit('close')
  }

  _initialize () {
    const signal = this.signal

    // It would log the errors and prevent of throw it.
    this.on('error', (...args) => log('error', ...args))

    signal.on('peer-error', err => this.emit('error', err))
    signal.on('error', err => this.emit('error', err))
    signal.open().catch(err => process.nextTick(() => this.emit('error', err)))
  }

  _createConnection (peer) {
    peer.channel = peer.topic

    peer.getInfo = () => ({
      id: peer.id,
      channel: peer.topic,
      initiator: peer.initiator
    })

    peer.printInfo = () => ({
      id: toHex(peer.id),
      channel: toHex(peer.topic),
      initiator: peer.initiator
    })

    log('createConnection', { info: peer.printInfo() })

    try {
      const duplicate = this._checkForDuplicate(peer)
      if (duplicate) {
        if (duplicate === peer) {
          // current incoming connection
          throw new ERR_CONNECTION_DUPLICATED(toHex(this.id), toHex(peer.id))
        } else {
          // old connection
          duplicate.destroy()
        }
      }

      this._bindSocketEvents(peer)

      return peer
    } catch (err) {
      this.emit('connect-failed', err, peer.getInfo())
      throw err
    }
  }

  _bindSocketEvents (peer) {
    const socket = peer
    const info = peer.getInfo()

    socket.on('error', err => {
      log('error', err)
      this.emit('connection-error', err, info)
    })

    socket.on('connect', () => {
      log('connect', { peer })
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
      this.emit('connection-closed', socket, info)
    })
  }

  _handshake (conn, info) {
    this._handleConnection(conn, info)
  }

  _handleConnection (conn, info) {
    this.emit('connection', conn, info)
  }

  _checkForDuplicate (peer) {
    const oldPeer = this.getPeers(peer.channel).find(p => p.id.equals(peer.id) && !p.sessionId.equals(peer.sessionId))
    if (!oldPeer) {
      return
    }

    const connections = [peer, oldPeer]

    /**
     * The first case is to have duplicate connections from the same origin (remote or local).
     * In this case we do a sort by connectionId and destroy the first one.
     */
    if ((peer.initiator && oldPeer.initiator) || (!peer.initiator && !oldPeer.initiator)) {
      return connections.sort((a, b) => Buffer.compare(a.sessionId, b.sessionId))[0]
    }

    /**
     * The second case is to have duplicate connections where each connection is started from different origins.
     * In this case we do a sort by peer id and destroy the first one.
     */
    const toDestroy = [this.id, peer.id].sort(Buffer.compare)[0]
    return connections.find(p => p.id.equals(toDestroy))
  }
}

module.exports = (...args) => new DiscoverySwarmWebrtc(...args)
module.exports.errors = errors
