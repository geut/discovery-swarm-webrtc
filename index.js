const { EventEmitter } = require('events')
const pump = require('pump')
const crypto = require('crypto')
const SimpleSignalClient = require('simple-signal-client')
const shuffle = require('lodash.shuffle')
const debug = require('debug')('discovery-swarm-webrtc')

const socketClustering = require('./lib/socket-clustering')

class DiscoverSwarmWebrtc extends EventEmitter {
  constructor (opts = {}) {
    super()
    debug('opts', opts)

    this.socket = socketClustering({ urls: opts.urls, createSocket: opts.socket })

    this.stream = opts.stream

    this.id = opts.id || crypto.randomBytes(12).toString('hex')

    this.multiplexer = opts.multiplexer || false

    this.simplePeerOpts = opts.simplePeer

    this.channels = new Map()

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

  _initialize (opts = {}) {
    const signal = this.signal

    const maxPeers = opts.maxPeers || 64

    signal.on('discover', async ({ peers, channel }) => {
      const connectedPeers = this.peers

      if (connectedPeers.length >= maxPeers) {
        return
      }

      // we select random candidates
      let candidates = shuffle(peers.filter(id => !this.findPeer({ id, channel }) && id !== this.id))

      candidates = candidates.slice(0, maxPeers - candidates.length)

      debug('candidates', candidates)

      await Promise.all(candidates.map(async id => {
        const info = { id, channel }

        this.addPeer(info)

        debug('connect', info)

        try {
          const { peer } = await this.signal.connect(info.id, { channel }, this.simplePeerOpts)
          this._initializePeer(peer, info)
        } catch (err) {
          this.delPeer(info)
          this.emit('connect-failed', err, info)
          this.emit('error', err, info)
        }
      }))
    })

    signal.on('request', async (request) => {
      const { initiator: id, metadata: { channel } } = request

      const info = { id, channel }

      debug('request', info)

      this.addPeer(info)

      try {
        const { peer } = await request.accept({}, this.simplePeerOpts) // Accept the incoming request
        this._initializePeer(peer, info)
      } catch (err) {
        this.delPeer(info)
        this.emit('connect-failed', err, info)
        this.emit('error', err, info)
      }
    })
  }

  _initializePeer (peer, info) {
    peer.on('error', err => {
      debug('error', err)
      this.emit('error', err, info)
    })

    peer.on('connect', () => {
      debug('connect', peer, info)

      if (!this.stream) {
        this.emit('connection', peer, info)
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
    })
  }

  _handshake (conn, info) {
    this.emit('connection', conn, info)
  }
}

module.exports = (...args) => new DiscoverSwarmWebrtc(...args)
