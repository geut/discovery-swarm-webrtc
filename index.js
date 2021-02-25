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

    const { id = crypto.randomBytes(32), bootstrap, stream, simplePeer, maxPeers = 5, timeout = 15 * 1000, signal, mmst = {} } = opts

    assert(Array.isArray(bootstrap) && bootstrap.length > 0, 'The `bootstrap` options is required.')
    assert(Buffer.isBuffer(id) && id.length === 32, 'The `id` option needs to be a Buffer of 32 bytes.')

    this.id = id

    const queueTimeout = timeout * 2

    const signalOptions = {
      id: this.id,
      bootstrap,
      createConnection: peer => this._createConnection(peer),
      requestTimeout: timeout,
      simplePeer,
      reconnectingWebsocket: {
        connectionTimeout: timeout
      }
    }

    this.signal = signal ? signal(signalOptions, this) : new MMSTSignalClient({
      ...signalOptions,
      mmstOpts: {
        maxPeers,
        queueTimeout, // queue mmst
        lookupTimeout: timeout,
        ...mmst
      }
    })

    this._maxPeers = maxPeers
    this._stream = stream
    this._destroyed = false

    this._initialize(opts)
  }

  get connected () {
    return this.signal.peersConnected
  }

  get connecting () {
    return this.signal.peersConnecting
  }

  listen () {
    // Empty method to respect the API of discovery-swarm
  }

  getPeers (channel) {
    if (channel) {
      return this.signal
        .getPeersByTopic(channel)
        .filter(p => p.connected)
    }
    return this.signal.peersConnected
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

  async connect (channel, peerId) {
    assert(channel && Buffer.isBuffer(channel), 'channel must be a buffer')
    assert(peerId && Buffer.isBuffer(peerId), 'peerId must be a buffer')

    const peer = this.signal.connect(channel, peerId)
    peer.subscribeMediaStream = true
    await peer.ready()
    return peer.stream
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
    signal.on('candidates-updated', (...args) => this.emit('candidates-updated', ...args))
  }

  _createConnection (peer) {
    peer.subscribeMediaStream = true

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
    const info = peer.getInfo()

    peer.on('error', err => {
      log('error', err)
      this.emit('connection-error', err, info)
    })

    peer.on('connect', () => {
      log('connect', { peer })
      if (peer.stream.destroyed) {
        return
      }

      if (!this._stream) {
        this._handleConnection(peer.stream, info)
        return
      }

      const conn = this._stream(info)
      if (!conn) {
        this._handleConnection(peer.stream, info)
        return
      }

      this.emit('handshaking', conn, info)
      conn.on('handshake', this._handshake.bind(this, conn, info))
      pump(peer.stream, conn, peer.stream)
    })

    peer.on('close', () => {
      log('close', { peer })
      this.emit('connection-closed', peer.stream, info)
    })
  }

  _handshake (conn, info) {
    this._handleConnection(conn, info)
  }

  _handleConnection (conn, info) {
    this.emit('connection', conn, info)
  }

  _checkForDuplicate (peer) {
    const oldPeer = this.signal.getPeersByTopic(peer.channel).find(p => p.id.equals(peer.id) && !p.sessionId.equals(peer.sessionId))
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
