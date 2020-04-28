const { SocketSignalWebsocketClient } = require('socket-signal-websocket')
const MMST = require('mostly-minimal-spanning-tree')
const assert = require('nanocustomassert')
const { Readable } = require('stream')

const log = require('debug')('discovery-swarm-webrtc:mmst-signal')
const { toHex } = require('./utils')
const { ERR_INVALID_CHANNEL, ERR_MAX_PEERS_REACHED } = require('./errors')
const Scheduler = require('./scheduler')

const assertChannel = channel => assert(Buffer.isBuffer(channel) && channel.length === 32, 'Channel must be a buffer of 32 bytes')

const kOnConnected = Symbol('mmstsignal.onconnected')
const kGetCandidates = Symbol('mmstsignal.getcandidates')

module.exports = class MMSTSignal extends SocketSignalWebsocketClient {
  constructor (opts = {}) {
    const { bootstrap, createConnection, maxPeers = 4, lookupTimeout = 5 * 1000, mmstTimeout = 10 * 1000, ...clientOpts } = opts
    super(bootstrap, { queueConcurrency: 10, ...clientOpts })

    this._createConnection = createConnection
    this._maxPeers = maxPeers
    this._channels = new Map()
    this._mmsts = new Map()
    this._candidates = new Map()
    this._lookupTimeout = lookupTimeout
    this._mmstTimeout = mmstTimeout
    this._scheduler = new Scheduler()
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
        await this.open()
        const peer = this.connect(to, channel)
        try {
          this._runCreateConnection(peer)
          await peer.waitForConnection()
          return peer
        } catch (err) {
          // Remove a candidate.
          const candidates = this[kGetCandidates](peer.channel)
          candidates.list = candidates.list.filter(candidate => !candidate.equals(peer.id))
          candidates.attempts = candidates.attempts - 1
          if (candidates.attempts === 0 || candidates.list.length === 0) {
            candidates.lookup = true
          }

          throw err
        }
      },
      maxPeers: this._maxPeers,
      lookupTimeout: this._lookupTimeout,
      queueTimeout: this._mmstTimeout
    })

    this._mmsts.set(channelStr, mmst)

    if (this.connected) {
      super.join(channel).catch(() => {})
    }
  }

  async leave (channel) {
    assertChannel(channel)

    const channelStr = toHex(channel)

    this._scheduler.delete(channelStr)
    this._mmsts.get(channelStr).destroy()
    this._mmsts.delete(channelStr)
    this._channels.delete(channelStr)
    this._candidates.delete(channelStr)

    await super.leave(channel)
  }

  async _open () {
    this.on('connected', this[kOnConnected])

    this.on('join', async (channel, peers) => {
      log('discover', { channel })

      if (!this.hasChannel(channel)) return

      await this._updateCandidates(channel, peers)
      await this._run(channel)

      this._scheduler.add(channel.toString('hex'), async () => {
        const candidates = this[kGetCandidates](channel)
        if (candidates.list.length === 0) {
          candidates.lookup = true
          await this._updateCandidates(channel)
          await this._run(channel)
        }
      })
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

    if (!peer.initiator && !mmst.shouldHandleIncoming()) throw new ERR_MAX_PEERS_REACHED(this._maxPeers)

    this._createConnection(peer)

    if (!peer.initiator) {
      mmst.addConnection(peer.id, peer)
    }

    return peer
  }

  async _close () {
    await super._close()
    this.removeListener('connected', this[kOnConnected])
    this._mmsts.forEach(mmst => mmst.destroy())
    this._mmsts.clear()
    this._channels.clear()
    this._candidates.clear()
    this._scheduler.clear()
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

    this._updateCandidates(channel).finally(() => {
      stream.push(this[kGetCandidates](channel).list)
      stream.push(null)
    })

    return stream
  }

  async [kOnConnected] (reconnected) {
    if (reconnected) {
      this._channels.forEach(channel => {
        return super.join(channel).catch(() => {})
      })
    }
  }

  async _updateCandidates (channel, peers) {
    // We try to minimize how many times we get candidates from the signal.
    const candidates = this[kGetCandidates](channel)

    let list = candidates.list
    if (peers) {
      list = peers
    } else if (candidates.lookup) {
      candidates.lookup = false
      candidates.attempts = 5
      list = await this.lookup(channel)
    }

    candidates.list = list.filter(id => !id.equals(this.id))

    this.emit('candidates-updated', channel, list)
  }

  [kGetCandidates] (channel) {
    assert(Buffer.isBuffer(channel))
    let candidates = this._candidates.get(toHex(channel))
    if (candidates) {
      return candidates
    }
    candidates = { list: [], attempts: 5, lookup: false }
    this._candidates.set(toHex(channel), candidates)
    return candidates
  }
}
