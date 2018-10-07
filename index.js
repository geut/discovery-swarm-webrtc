const assert = require('assert')
const EventEmitter = require('events')
const createSwarm = require('webrtc-swarm')
const pump = require('pump')

const _handshake = Symbol('handshake')

class DiscoverSwarmWebrtc extends EventEmitter {
  constructor (opts = {}) {
    super()

    assert(typeof opts.stream === 'function', 'A `stream` function prop is required.')

    this.id = opts.id
    this.stream = opts.stream
    this.channels = new Map()
  }

  join (hub, opts = {}) {
    assert(hub && typeof hub === 'object', 'A SignalHub instance is required.')

    if (this.channels.has(hub.app)) {
      throw new Error(`Swarm with the hub name '${hub.app}' already defined`)
    }

    const channel = {
      peers: new Map(),
      swarm: createSwarm(hub, Object.assign({}, {
        uuid: this.id
      }, opts))
    }

    channel.swarm.on('peer', (peer, id) => {
      const conn = this.stream()
      this.emit('handshaking', conn, { id })
      conn.on('handshake', this[_handshake].bind(this, channel, conn, id))
      pump(peer, conn, peer)
    })

    channel.swarm.on('disconnect', (peer, id) => {
      channel.peers.delete(id)
      this.emit('connection-closed', peer, { id })
    })

    this.channels.set(hub.name, channel)
  }

  [_handshake] (channel, conn, id) {
    if (channel.peers.has(id)) {
      const oldPeer = channel.peers.get(id)
      this.emit('redundant-connection', oldPeer, { id })
      channel.peers.delete(id)
      oldPeer.destroy()
    }

    channel.peers.set(id, conn)
    this.emit('connection', conn, { id })
  }
}

module.exports = (...args) => new DiscoverSwarmWebrtc(...args)
