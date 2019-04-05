const { EventEmitter } = require('events')
const pump = require('pump')
const crypto = require('crypto')
const shuffle = require('lodash.shuffle')
const assert = require('assert')
const parseUrl = require('socket.io-client/lib/url')
const timestamp = require('monotonic-timestamp')

const debug = require('debug')('discovery-swarm-webrtc')
const SignalClient = require('./lib/signal-client')

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

    this.closedChannels = new Set()

    this.candidates = new Map()

    this.destroyed = false

    this.signal = new SignalClient(this.socket)

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

  addPeer (info, peer = {}) {
    peer = Object.assign(peer, info)

    this.channels.get(info.channel).set(info.id, peer)

    return peer
  }

  delPeer ({ id, channel }) {
    const peers = this.channels.get(channel)

    if (peers) {
      peers.delete(id)
    }
  }

  join (channel) {
    // Account for buffers being passed in
    const channelString = channel.toString('hex')
    if (this.channels.has(channelString)) {
      return
    }

    this.channels.set(channelString, new Map())
    this.closedChannels.delete(channelString)

    if (this.socket.connected) {
      this.signal.discover({ id: this.id, channel: channelString })
    }
  }

  leave (channel) {
    // Account for buffers being passed in
    const channelString = channel.toString('hex')

    let peers = this.channels.get(channelString)

    if (!peers) return

    this.closedChannels.add(channelString)

    // we need to notify to the signal that we our leaving
    this.signal.leave({ id: this.id, channel: channelString }).then(() => {}).catch(() => {})

    for (let peer of peers.values()) {
      // Destroy the connection, should emit close and remove it from the list
      peer.destroy && peer.destroy()
    }

    // we need to remove the candidates for this channel
    this.candidates.delete(channelString)
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
      debug('discover', { peers, channel })

      // Ignore discovered channels we left
      if (!this.channels.has(channel)) return

      // Ignore if the channel was closed
      if (this.closedChannels.has(channel)) return

      if (this.peers.length >= this.maxPeers) {
        return
      }

      // we do a random candidate list
      await this._updateCandidates({ channel }, peers)

      await this._lookupAndConnect({ channel })
    })

    signal.on('request', async (request) => {
      const { initiator: id, metadata: { channel } } = request

      // Ignore requests from channels we're not a part of
      if (!this.channels.has(channel)) return

      // Ignore if the channel was closed
      if (this.closedChannels.has(channel)) return

      const info = { id, channel }

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
    // Ignore if the channel was closed
    if (this.closedChannels.has(channel)) return

    const _connect = async id => this._createPeer({ info: { id, channel } })

    if (id) {
      if (this.findPeer({ id, channel })) {
        return null
      }

      return _connect(id)
    }

    let candidates = this.candidates.get(channel)

    if (!candidates) {
      return
    }

    // remove peers already connected
    candidates = candidates.filter(id => !this.findPeer({ id, channel }))

    // select peers based on the maximum size of peers allowed
    const peers = this.channels.get(channel)
    const maxPeers = this.maxPeers - (peers ? peers.size : 0)
    candidates = candidates.slice(0, maxPeers)

    debug('candidates', candidates)

    return Promise.all(candidates.map(_connect))
  }

  async _createPeer ({ request, info }) {
    debug(`createPeer from ${request ? 'request' : 'connect'}`, { info, request })

    try {
      let result

      const oldPeer = this.findPeer(info)

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
            debug(`tie-breaker wins localPeer: ${this.id}`)
            request.reject({ reason: 'tie-breaker' })
            return
          }
        }
      }

      // we save the peer just to be sure that is connecting and trying to get a peer instance
      info.connectingAt = timestamp()
      this.addPeer(info)

      if (request) {
        result = await request.accept({}, this.simplePeerOpts) // Accept the incoming request
      } else {
        result = await this.signal.connect(info.id, { channel: info.channel, connectingAt: info.connectingAt }, this.simplePeerOpts)
      }

      const { peer } = result

      // we got a peer instance, we update the peer list
      this.addPeer(info, peer)

      this._bindPeerEvents(peer, info)
    } catch (err) {
      if (err.metadata && err.metadata.reason === 'tie-breaker') {
        debug(`tie-breaker wins remotePeer: ${info.id}`)
        return
      }

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
      debug('connect', { peer, info })
      delete peer.connectingAt

      // race condition: if the connection already was created and we leave from the channel or close de swarm
      if (this.closedChannels.has(info.channel)) {
        peer.destroy()
        return
      }

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
      debug('close', { peer, info })

      const savedPeer = this.findPeer(info)

      if (savedPeer !== peer) {
        // Old connection, we already have a new one.
        debug('closing old-connection', { savedPeer, peer })
        return
      }

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
    this.emit('connection', conn, info)
  }

  // TODO: this is experimental, is going to change
  async _reconnect (info) {
    // Ignore if the channel was closed
    if (this.closedChannels.has(info.channel)) return

    try {
      await this._updateCandidates(info)
      return this._lookupAndConnect({ channel: info.channel })
    } catch (err) {
      this.emit('reconnection-error', err, info)
    }
  }

  async _updateCandidates (info, peers) {
    if (!peers) {
      const result = await this.signal.candidates({ channel: info.channel })
      peers = result.peers
    }

    this.candidates.set(info.channel, shuffle(peers.filter(id => id !== this.id)))
  }
}

module.exports = (...args) => new DiscoverySwarmWebrtc(...args)
