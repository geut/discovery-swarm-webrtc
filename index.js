const { EventEmitter } = require('events')
const pump = require('pump')
const crypto = require('crypto')
const SimpleSignalClient = require('simple-signal-client')
const shuffle = require('lodash.shuffle')
const debug = require('debug')('discovery-swarm-webrtc')

const socketClustering = require('./lib/socket-clustering')

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

class DiscoverSwarmWebrtc extends EventEmitter {
  constructor (opts = {}) {
    super()
    debug('opts', opts)

    this.socket = socketClustering({ urls: opts.urls, createSocket: opts.socket })

    this.stream = opts.stream

    this.id = opts.id || crypto.randomBytes(12).toString('hex')

    this.multiplexer = opts.multiplexer || false

    this.simplePeerOpts = opts.simplePeer

    this.maxPeers = opts.maxPeers || 64

    this.maxAttempts = opts.maxAttempts || Infinity

    this.timeout = opts.timeout || 1000

    this.channels = new Map()

    this.candidates = new Map()

    this.attempts = new Map()

    this.destroyed = false

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
    if (this.channels.has(channel)) {
      return
    }

    this.channels.set(channel, new Map())

    if (this.socket.connected) {
      this.signal.discover({ id: this.id, channel })
      return
    }

    this.socket.on('connect', () => {
      this.signal.discover({ id: this.id, channel })
    })
  }

  _initialize () {
    const signal = this.signal

    signal.on('discover', async ({ peers, channel }) => {
      if (this.peers.length >= this.maxPeers) {
        return
      }

      // we do a random candidate list
      this.candidates.set(channel, shuffle(peers.filter(id => id !== this.id)))

      await this._lookupAndConnect({ channel })
    })

    signal.on('request', async (request) => {
      const { initiator: id, metadata: { channel } } = request

      const info = { id, channel }

      debug('request', info)

      await this._createPeer({ request, info })
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

  // experimental
  async _reconnect (info) {
    const id = `${info.id}:${info.channel}`

    let attempts = this.attempts.get(id)

    if (this.maxAttempts === -1 || attempts === 0) {
      return
    }

    if (this.maxAttempts !== Infinity && attempts === undefined) {
      // init the attempts
      attempts = this.maxAttempts
    }

    if (attempts !== undefined) {
      attempts--
      this.attempts.set(id, attempts)
    }

    this.emit('reconnecting', info)

    await sleep(this.timeout)

    await this._lookupAndConnect(info)
  }
}

module.exports = (...args) => new DiscoverSwarmWebrtc(...args)
