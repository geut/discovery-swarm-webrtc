const { SocketSignalWebsocketClient } = require('socket-signal-websocket')
const MMST = require('mostly-minimal-spanning-tree')
const debounce = require('p-debounce')
const assert = require('nanocustomassert')
const { Readable } = require('stream')

const log = require('debug')('discovery-swarm-webrtc:mmst-signal')
const Scheduler = require('./scheduler')
const { toHex } = require('./utils')
const { ERR_INVALID_CHANNEL, ERR_MAX_PEERS_REACHED } = require('./errors')

const assertChannel = channel => assert(Buffer.isBuffer(channel) && channel.length === 32, 'Channel must be a buffer of 32 bytes')

const kOnConnected = Symbol('mmstsignal.onconnected')
const kGetCandidates = Symbol('mmstsignal.getcandidates')

module.exports = class MMSTSignal extends SocketSignalWebsocketClient {
  constructor (opts = {}) {
    const { bootstrap, createConnection, maxPeers = 4, ...clientOpts } = opts
    super(bootstrap, clientOpts)

    this._createConnection = createConnection
    this._maxPeers = maxPeers
    this._channels = new Map()
    this._mmsts = new Map()
    this._candidates = new Map()
    this._scheduler = new Scheduler()
    this._updateCandidates = debounce(this._updateCandidates, 500)
    this[kOnConnected] = this[kOnConnected].bind(this)
  }

  join (channel) {
    assertChannel(channel)

    const channelStr = toHex(channel)
    if (this._channels.has(channelStr)) {
      return
    }

    this._channels.set(channelStr, channel)

    const mmst = new MMST({
      id: this.id,
      lookup: () => this._lookup(channel),
      connect: async (to) => {
        const peer = this.connect(to, channel)
        this._runCreateConnection(peer)
        try {
          await peer.waitForConnection()
          return peer
        } catch (err) {
          if (ERR_INVALID_CHANNEL.equals(err) || err.code === 'ERR_PEER_NOT_FOUND' || err.code === 'NMSG_ERR_TIMEOUT') {
            // Remove a candidate.
            const candidates = this[kGetCandidates](peer.channel)
            candidates.list = candidates.list.filter(candidate => !candidate.equals(peer.id))
          }
          throw err
        }
      },
      maxPeers: this._maxPeers,
      lookupTimeout: 5 * 1000
    })

    this._mmsts.set(channelStr, mmst)

    this._scheduler.addTask(channelStr, async (task) => {
      if (!this.hasChannel(channel)) return task.destroy()

      await this._run(channel)

      const connected = this.getPeersByTopic(channel)
      const { list } = this[kGetCandidates](channel)
      if (list.length === 0 || connected.length === list.length) return 30 * 1000
    }, 10 * 1000)

    if (this.connected) {
      super.join(channel).catch(() => {})
    }
  }

  async leave (channel) {
    assertChannel(channel)

    await super.leave(channel)

    const channelStr = toHex(channel)

    this._scheduler.deleteTask(channelStr)
    this._mmsts.get(channelStr).destroy()
    this._mmsts.delete(channelStr)
    this._channels.delete(channelStr)
    this._candidates.delete(channelStr)
  }

  async _open () {
    this.on('connected', this[kOnConnected])

    this.on('join', async (channel, peers) => {
      log('discover', { channel })

      if (peers.length === 0) return
      if (!this.hasChannel(channel)) return

      await this._updateCandidates(channel, peers)
      await this._run(channel)
      this._scheduler.startTask(toHex(channel))
    })

    this.onIncomingPeer((peer) => this._runCreateConnection(peer))
    await super._open()
  }

  hasChannel (channel) {
    return this._channels.has(toHex(channel))
  }

  _runCreateConnection (peer) {
    if (!this.hasChannel(peer.topic)) {
      throw new ERR_INVALID_CHANNEL(toHex(peer.topic))
    }

    const mmst = this._getMMST(peer.topic)

    if (!peer.initiator && !mmst.shouldHandleIncoming()) {
      throw new ERR_MAX_PEERS_REACHED(this._maxPeers)
    }

    this._createConnection(peer)

    if (!peer.initiator) {
      mmst.addConnection(peer.id, peer)
    }

    return peer
  }

  async _close () {
    await super._close()
    this.removeListener('connected', this[kOnConnected])
    this._scheduler.clearTasks()
    this._mmsts.forEach(mmst => mmst.destroy())
    this._mmsts.clear()
    this._channels.clear()
    this._candidates.clear()
  }

  async _updateCandidates (channel, peers) {
    if (!this.connected) return

    // We try to minimize how many times we get candidates from the signal.
    const { lastUpdate } = this[kGetCandidates](channel)
    const newUpdate = Date.now()
    if (newUpdate - lastUpdate < 5 * 1000) return

    let list = []
    if (peers) {
      list = peers
    } else {
      list = await this.lookup(channel)
    }

    list = list.filter(id => !id.equals(this.id))

    this._candidates.set(toHex(channel), { lastUpdate: Date.now(), list })

    this.emit('candidates-updated', channel, list)
  }

  async _run (channel) {
    if (!this.connected) return
    if (this.getPeersByTopic(channel).filter(p => p.initiator).length > 0) return

    try {
      if (this.hasChannel(channel)) {
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
      stream.push(this[kGetCandidates](channel).list)
      stream.push(null)
    }).catch(() => {
      stream.push(this[kGetCandidates](channel).list)
      stream.push(null)
    })

    return stream
  }

  async [kOnConnected] () {
    this._channels.forEach(channel => {
      return super.join(channel).catch(() => {})
    })
  }

  [kGetCandidates] (channel) {
    assert(Buffer.isBuffer(channel))
    return this._candidates.get(toHex(channel)) || { list: [], lastUpdate: 0 }
  }
}
