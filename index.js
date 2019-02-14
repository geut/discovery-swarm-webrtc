const assert = require('assert')
const EventEmitter = require('events')
const createSwarm = require('webrtc-swarm')
const pump = require('pump')
const noop = () => void 0

class DiscoverSwarmWebrtc extends EventEmitter {
  constructor (opts = {}) {
    super()

    assert(typeof opts.stream === 'function', 'A `stream` function prop is required.')

    this.id = opts.id
    this.stream = opts.stream
    this.channels = new Map()
    this.destroyed = false
  }

  join (hub, opts = {}) {
    assert(hub && typeof hub === 'object', 'A SignalHub instance is required.')

    const channelName = hub.app

    if (this.channels.has(channelName)) {
      throw new Error(`Swarm with the channel '${channelName}' already defined`)
    }

    const channel = {
      peers: new Map(),
      swarm: createSwarm(hub, Object.assign({}, {
        uuid: this.id
      }, opts))
    }

    channel.swarm.on('peer', (peer, id) => {
      const info = { id, channel: channelName }
      const conn = this.stream(info)
      this.emit('handshaking', conn, info)
      conn.on('handshake', this._handshake.bind(this, channel, conn, info))
      pump(peer, conn, peer)
    })

    channel.swarm.on('disconnect', (peer, id) => {
      const info = { id, channel: channelName }
      channel.peers.delete(id)
      this.emit('connection-closed', peer, info)
    })

    this.channels.set(channelName, channel)
  }

  close (cb) {
    if (this.destroyed) return process.nextTick(cb || noop)

    this.destroyed = true

    if(cb) this.once('close', cb)

    if (!this.channels.size) return process.nextTick(() => {
      this.emit('close')
    })

    this.channels.forEach((channel, channelName) => {
      channel.swarm.close(() => {
        this.channels.delete(channelName)
        if(!this.channels.size) this.emit('close')
      })
    })
  }

  destroy (cb) {
    this.close(cb)
  }

  _handshake (channel, conn, info) {
    const { id } = info

    if (channel.peers.has(id)) {
      const oldPeer = channel.peers.get(id)
      this.emit('redundant-connection', oldPeer, info)
      channel.peers.delete(id)
      oldPeer.destroy()
    }

    channel.peers.set(id, conn)
    this.emit('connection', conn, info)
  }
}

module.exports = (...args) => new DiscoverSwarmWebrtc(...args)
