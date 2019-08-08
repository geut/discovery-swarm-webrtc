const { EventEmitter } = require('events')
const { Readable } = require('stream')
const crypto = require('crypto')

const pump = require('pump')
const io = require('socket.io-client')
const parseUrl = require('socket.io-client/lib/url')
const timestamp = require('monotonic-timestamp')
const MMST = require('mostly-minimal-spanning-tree')

const debug = require('debug')('discovery-swarm-webrtc')
const SignalClient = require('./lib/signal-client')

const ERR_TIE_BREAKER = 'ERR_TIE_BREAKER'

const toHex = buff => {
  if (typeof buff === 'string') {
    return buff
  }

  if (Buffer.isBuffer(buff)) {
    return buff.toString('hex')
  }

  throw new Error('Cannot convert to hex the buffer: ', buff)
}

const toBuffer = str => {
  if (Buffer.isBuffer(str)) {
    return str
  }

  if (typeof str === 'string') {
    return Buffer.from(str, 'hex')
  }

  throw new Error('Cannot convert to buffer the string: ', str)
}

class DiscoverySwarmWebrtc extends EventEmitter {
  constructor (opts = {}) {
    super()
    debug('opts', opts)

    console.assert(Array.isArray(opts.urls) && opts.urls.length > 0, 'An array of urls is required.')

    this._id = opts.id || crypto.randomBytes(12)

    this._stream = opts.stream

    this._simplePeerOptions = opts.simplePeerOptions

    this._channels = new Map()

    this._closedChannels = new Set()

    this._mmsts = new Map()

    this._candidates = new Map()

    this._destroyed = false

    this._urls = opts.urls.map(url => parseUrl(url).source)

    this._socket = io(this._urls[0], opts.socketOptions)

    this.signal = new SignalClient(this._socket, { connectionTimeout: opts.connectionTimeout })

    this._initialize(opts)
  }

  get id () {
    return this._id
  }

  get connecting () {
    return this.peers().filter(peer => peer.connectingAt !== undefined).length
  }

  get connected () {
    return this.peers().filter(peer => peer.connectingAt === undefined).length
  }

  listen () {
    // Empty method to respect the API of discovery-swarm
  }

  peers (channelName) {
    channelName = toHex(channelName)

    if (channelName) {
      const channel = this._channels.get(channelName)
      if (channel) {
        return Array.from(channel.values())
      }
      return []
    }

    let peers = []

    for (const channel of this._channels.values()) {
      peers = [...peers, ...Array.from(channel.values())]
    }

    return peers
  }

  join (channel) {
    // Account for buffers being passed in
    const channelString = toHex(channel)
    if (this._channels.has(channelString)) {
      return
    }

    this._channels.set(channelString, new Map())
    this._closedChannels.delete(channelString)

    this._mmsts.set(channelString, new MMST({
      id: this._id,
      lookup: () => this._lookup(channelString),
      connect: (to) => this._connect(to, channelString)
    }))

    if (this._socket.connected) {
      this.signal.discover({ id: toHex(this._id), channel: channelString })
    }
  }

  leave (channel) {
    // Account for buffers being passed in
    const channelString = channel.toString('hex')

    let peers = this._channels.get(channelString)

    if (!peers) return

    this._closedChannels.add(channelString)

    // we need to notify to the signal that we our leaving
    this.signal.leave({ id: this._id, channel: channelString }).then(() => {}).catch(() => {})

    for (let peer of peers.values()) {
      // Destroy the connection, should emit close and remove it from the list
      peer.destroy && peer.destroy()
    }

    // we need to remove the candidates for this channel
    this._candidates.delete(channelString)
    this._channels.delete(channelString)
    this._mmsts.get(channelString).destroy()
    this._mmsts.delete(channelString)
  }

  close (cb) {
    if (this._destroyed) {
      if (cb) process.nextTick(cb)
      return
    }

    this._destroyed = true

    if (cb) this.once('close', cb)

    this.signal.destroy()
    this._mmsts.forEach(mmst => mmst.destroy())
    this._mmsts.clear()

    process.nextTick(() => this.emit('close'))
  }

  _initialize () {
    const signal = this.signal

    signal.on('discover', async ({ peers, channel }) => {
      debug('discover', { peers, channel })

      // Ignore requests from channels we're not a part of
      if (!this._channels.has(channel)) return

      // Ignore if the channel was closed
      if (this._isClosed(channel)) return

      // we do a random candidate list
      await this._updateCandidates({ channel }, peers)
    })

    signal.on('request', async (request) => {
      const { initiator: id, metadata: { channel } } = request

      // Ignore requests from channels we're not a part of
      if (!this._channels.has(channel)) return

      // Ignore if the channel was closed
      if (this._isClosed(channel)) return

      const info = { id: toBuffer(id), channel: toBuffer(channel) }

      await this._createPeer({ request, info })
    })

    signal.on('info', data => this.emit('info', data))

    this._socket.on('connect', () => {
      for (let channel of this._channels.keys()) {
        this.signal.discover({ id: toHex(this._id), channel: toHex(channel) })
      }
    })

    this._socket.on('reconnect_error', error => {
      this.emit('socket:reconnect_error', error)
      const lastUrl = this._socket.io.uri
      const lastIdx = this._urls.indexOf(lastUrl)
      const nextIdx = lastIdx === (this._urls.length - 1) ? 0 : lastIdx + 1
      this._socket.io.uri = this._urls[nextIdx]
    })
  }

  _findPeer ({ id, channel }) {
    const item = this._channels.get(toHex(channel))

    if (!item) {
      return null
    }

    return item.get(toHex(id))
  }

  _addPeer (info, peer = {}) {
    peer = Object.assign(peer, info)

    this._channels.get(toHex(info.channel)).set(toHex(info.id), peer)

    return peer
  }

  _deletePeer ({ id, channel }) {
    const peers = this._channels.get(toHex(channel))

    if (peers) {
      peers.delete(toHex(id))
    }
  }

  _isClosed (channel) {
    return this._closedChannels.has(toHex(channel))
  }

  async _createPeer ({ request, info }) {
    debug(`createPeer from ${request ? 'request' : 'connect'}`, { info, request })

    try {
      let result

      const oldPeer = this._findPeer(info)

      if (oldPeer) {
        if (oldPeer && !oldPeer.connectingAt && !oldPeer.destroyed) {
          this.emit('redundant-connection', oldPeer, info)
          debug('redundant-connection', oldPeer, info)
          oldPeer.destroy()
        } else if (!!request && oldPeer.connectingAt) {
          // tie-breaker connection: When both peer runs a signal.connect.
          const { connectingAt: requestConnectingAt } = request.metadata

          // oldPeer wins
          if (requestConnectingAt > oldPeer.connectingAt) {
            debug(`tie-breaker wins localPeer: ${toHex(this._id)}`)
            request.reject({ code: ERR_TIE_BREAKER })
            return
          }
        }
      }

      // we save the peer just to be sure that is connecting and trying to get a peer instance
      info.connectingAt = timestamp()
      this._addPeer(info)

      if (request) {
        result = await request.accept({}, this._simplePeerOptions) // Accept the incoming request
      } else {
        result = await this.signal.connect(toHex(info.id), { channel: toHex(info.channel), connectingAt: info.connectingAt }, this._simplePeerOptions)
      }

      const { peer } = result

      // we got a peer instance, we update the peer list
      this._addPeer(info, peer)

      this._bindPeerEvents(peer, info)

      return peer
    } catch (err) {
      const error = SignalClient.parseMetadataError(err)

      if (error.code === ERR_TIE_BREAKER) {
        debug(`tie-breaker wins remotePeer: ${toHex(info.id)}`)
        return
      }

      this._deletePeer(info)
      this.emit('connect-failed', error, info)
      this.emit('error', error, info)
    }
  }

  _bindPeerEvents (peer, info) {
    peer.on('error', err => {
      debug('error', err)
      this.emit('connection-error', err, info)
    })

    peer.on('connect', () => {
      debug('connect', { peer, info })
      delete peer.connectingAt

      // race condition: if the connection already was created and we leave from the channel or close de swarm
      if (this._isClosed(info.channel)) {
        peer.destroy()
        return
      }

      if (!this._stream) {
        this._handleConnection(peer, info)
        return
      }

      const conn = this._stream(info)
      this.emit('handshaking', conn, info)
      conn.on('handshake', this._handshake.bind(this, conn, info))
      pump(peer, conn, peer)
    })

    peer.on('close', () => {
      debug('close', { peer, info })

      const savedPeer = this._findPeer(info)

      if (savedPeer !== peer) {
        // Old connection, we already have a new one.
        debug('closing old-connection', { savedPeer, peer })
        return
      }

      this._deletePeer(info)

      this.emit('connection-closed', peer, info)

      this._updateCandidates(info)
    })
  }

  _handshake (conn, info) {
    this._handleConnection(conn, info)
  }

  _handleConnection (conn, info) {
    this.emit('connection', conn, info)
  }

  async _updateCandidates (info, peers) {
    try {
      if (!peers) {
        const result = await this.signal.candidates({ channel: toHex(info.channel) })
        peers = result.peers
      }

      this._candidates.set(toHex(info.channel), peers.map(id => toBuffer(id)).filter(id => !id.equals(this._id)))
    } catch (err) {
      this.emit('error', err)
    }
  }

  _lookup (channel) {
    const stream = new Readable({
      read () {
        this.push(this._candidates.get(channel))
        this.push(null)
      },
      objectMode: true
    })

    return stream
  }

  async _connect (id, channel) {
    const connection = await this._createPeer({ info: { id, channel: toBuffer(channel) } })
    this._mmsts.get(channel).handleIncoming(this._id, connection)
    return connection
  }
}

module.exports = (...args) => new DiscoverySwarmWebrtc(...args)
