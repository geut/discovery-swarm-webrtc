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
    const { bootstrap, createConnection, mmstOpts = {}, strict = true, ...clientOpts } = opts
    super(bootstrap, clientOpts)

    this._createConnection = createConnection
    this._mmstOpts = mmstOpts

    // if strict is false the network will allow situations where the maxPeers can be higher if is needed.
    this._strict = strict

    this._channels = new Map()
    this._mmsts = new Map()
    this._candidates = new Map()
    this._scheduler = new Scheduler()

    this[kOnConnected] = this[kOnConnected].bind(this)
  }

  join (channel) {
    assertChannel(channel)

    const channelStr = toHex(channel)
    if (!this._channels.has(channelStr)) {
      this._channels.set(channelStr, channel)
      const defaultOpts = {
        id: this.id,
        lookup: () => this._lookup(channel),
        connect: async (to) => {
          await this.open()

          try {
            const peer = this.connect(channel, to)
            this._runCreateConnection(peer)
            await peer.ready()
            return peer.stream
          } catch (err) {
          // Remove a candidate.
            const candidates = this[kGetCandidates](channel)
            candidates.list = candidates.list.filter(candidate => !candidate.equals(to))
            if (candidates.list.length === 0) {
              candidates.lookup = true
            }
            throw err
          }
        }
      }

      let mmst
      if (typeof this._mmstOpts === 'function') {
        mmst = this._mmstOpts(defaultOpts)
      } else {
        mmst = new MMST({
          ...this._mmstOpts,
          ...defaultOpts
        })
      }

      this._mmsts.set(channelStr, mmst)
    }

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
    await super.closeConnectionsByTopic(channel)
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
        if (candidates.list.length === 0 || this.getPeersByTopic(channel).length === 0) {
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

    if (this._strict && !peer.initiator && !mmst.shouldHandleIncoming()) {
      throw new ERR_MAX_PEERS_REACHED(this._mmstOpts.maxPeers)
    }

    this._createConnection(peer)

    if (!peer.initiator) {
      mmst.addConnection(peer.id, peer.stream)
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
    this._channels.forEach(channel => {
      return super.join(channel).catch(() => {})
    })
  }

  async _updateCandidates (channel, peers) {
    // We try to minimize how many times we get candidates from the signal.
    const candidates = this[kGetCandidates](channel)

    let list = candidates.list
    if (peers) {
      list = peers
    } else if (candidates.lookup) {
      candidates.lookup = false
      try {
        list = await this.lookup(channel)
      } catch (err) {}
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
    candidates = { list: [], lookup: false }
    this._candidates.set(toHex(channel), candidates)
    return candidates
  }
}
