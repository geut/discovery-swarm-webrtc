const { EventEmitter } = require('events')
const pump = require('pump')
const crypto = require('crypto')
const SimpleSignalClient = require('simple-signal-client')
const shuffle = require('lodash.shuffle')
const assert = require('assert')
const debug = require('debug')('discovery-swarm-webrtc')
const parseUrl = require('socket.io-client/lib/url')

class DiscoverySwarmWebrtc extends EventEmitter {
  constructor (opts = {}) {
    super()
    debug('opts', opts)

    assert(Array.isArray(opts.urls) && opts.urls.length > 0, 'An array of urls is required.')

    this.urls = opts.urls.map(url => parseUrl(url).source)

    if (opts.socket) {
      this.socket = opts.socket(this.urls[0])
    } else {
      this.socket = require('socket.io-client')(this.urls[0])
    }

    this.stream = opts.stream

    this.id = opts.id || crypto.randomBytes(12).toString('hex')

    this.simplePeerOpts = opts.simplePeer

    this.maxPeers = opts.maxPeers || 64

    this.channels = new Map()

    this.candidates = new Map()

    this.signal = new SimpleSignalClient(this.socket)

    this._initialize(opts)
  }

  get peers () {
    let peers = []

    for (const channel of this.channels.values()) {
      peers = [...peers, ...Array.from(channel.values())]
    }

    return peers
  }

  findPeer ({ id, channel }) {
    const item = this.channels.get(channel)

    if (!item) {
      return null
    }

    return item.get(id)
  }

  addPeer (info, peer) {
    this.channels.get(info.channel).set(info.id, peer || info)
    return peer
  }

  delPeer ({ id, channel }) {
    this.channels.get(channel).delete(id)
  }

  join (channel) {
    // Account for buffers being passed in
    const channelString = channel.toString('hex')
    if (this.channels.has(channelString)) {
      return
    }

    this.channels.set(channelString, new Map())

    if (this.socket.connected) {
      this.signal.discover({ id: this.id, channel: channelString })
    }
  }

  leave (channel) {
    // Account for buffers being passed in
    const channelString = channel.toString('hex')
    const peers = this.channels.get(channelString)
    if (!peers) return

    for (let peer of peers) {
      // Destroy the connection, should emit close and remove it from the list
      peer.destroy()
    }

    this.channels.delete(channelString)
  }

  close (cb) {
    if (this.destroyed) {
      if (cb) process.nextTick(cb)
      return
    }
    this.destroyed = true

    if (cb) this.once('close', cb)

    this.signal.destroy()

    process.nextTick(() => this.emit('close'))
  }

  _initialize () {
    const signal = this.signal

    signal.on('discover', async ({ peers, channel }) => {
      // Ignore discovered channels we left
      if (!this.channels.has(channel)) return

      if (this.peers.length >= this.maxPeers) {
        return
      }

      // we do a random candidate list
      this.candidates.set(channel, shuffle(peers.filter(id => id !== this.id)))

      await this._lookupAndConnect({ channel })
    })

    signal.on('request', async (request) => {
      const { initiator: id, metadata: { channel } } = request

      // Ignore requests from channels we're not a part of
      if (!this.channels.has(channel)) return

      const info = { id, channel }

      debug('request', info)

      await this._createPeer({ request, info })
    })

    this.socket.on('connect', () => {
      for (let channel of this.channels.keys()) {
        this.signal.discover({ id: this.id, channel })
      }
    })

    this.socket.on('reconnect_error', error => {
      this.emit('socket:reconnect_error', error)
      const lastUrl = this.socket.io.uri
      const lastIdx = this.urls.indexOf(lastUrl)
      const nextIdx = lastIdx === (this.urls.length - 1) ? 0 : lastIdx + 1
      this.socket.io.uri = this.urls[nextIdx]
    })
  }

  async _lookupAndConnect ({ id, channel }) {
    const _connect = async id => this._createPeer({ info: { id, channel } })

    if (id) {
      if (this.findPeer({ id, channel })) {
        return null
      }

      return _connect(id)
    }

    let candidates = this
      .candidates
      .get(channel)
      .filter(id => !this.findPeer({ id, channel }))

    candidates = candidates.slice(0, this.maxPeers - candidates.length)

    debug('candidates', candidates)

    return Promise.all(candidates.map(_connect))
  }

  async _createPeer ({ request, info }) {
    this.addPeer(info)

    debug(request ? 'request' : 'connect', info)

    try {
      let result

      if (request) {
        result = await request.accept({}, this.simplePeerOpts) // Accept the incoming request
      } else {
        result = await this.signal.connect(info.id, { channel: info.channel }, this.simplePeerOpts)
      }

      const { peer } = result
      peer.id = info.id

      this._bindPeerEvents(peer, info)
    } catch (err) {
      this.delPeer(info)
      this.emit('connect-failed', err, info)
      this.emit('error', err, info)
    }
  }

  _bindPeerEvents (peer, info) {
    peer.on('error', err => {
      debug('error', err)
      this.emit('connection-error', err, info)
    })

    peer.on('connect', () => {
      debug('connect', peer, info)

      if (!this.stream) {
        this._handleConnection(peer, info)
        return
      }

      const conn = this.stream(info)
      this.emit('handshaking', conn, info)
      conn.on('handshake', this._handshake.bind(this, conn, info))
      pump(peer, conn, peer)
    })

    peer.on('close', () => {
      debug('close', info)
      this.delPeer(info)
      this.emit('connection-closed', peer, info)

      // TODO: We need to define when we want to reconnect
      this._reconnect(info)
    })
  }

  _handshake (conn, info) {
    this._handleConnection(conn, info)
  }

  _handleConnection (conn, info) {
    this.attempts.delete(`${info.id}:${info.channel}`)
    this.emit('connection', conn, info)
  }

  // TODO: this is experimental, is going to change
  async _reconnect () {
    return this._lookupAndConnect()
  }
}

module.exports = (...args) => new DiscoverySwarmWebrtc(...args)
