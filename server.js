const debug = require('debug')('discovery-swarm-webrtc')
const SignalServer = require('./lib/signal-server')

class SignalSwarmServer extends SignalServer {
  constructor ({ io }) {
    super(io)

    this.channels = new Map()

    this._initialize()
  }

  getPeers (channel, create = false) {
    if (!channel) throw new Error('Channel is required.')

    let peers = new Map()

    if (this.channels.has(channel)) {
      peers = this.channels.get(channel)
    } else if (create) {
      this.channels.set(channel, peers)
    }

    return peers
  }

  _initialize () {
    this.on('discover', (request) => {
      try {
        const { id: socketId } = request.socket
        const { id, channel } = request.discoveryData

        const peers = this.getPeers(channel, true)

        peers.set(socketId, id)

        debug(`discover: ${id} channel: ${channel}`)

        request.discover(id, { peers: Array.from(peers.values()), channel })
      } catch (err) {
        console.error(err)
      }
    })

    this.on('disconnect', (socket) => {
      try {
        const { id: socketId } = socket

        this.channels.forEach((peers, channel) => {
          const id = peers.get(socketId)
          if (id && peers.delete(socketId)) {
            debug(`disconnect: ${id} channel: ${channel}`)
            this.emit('peer:leave', { socket, id, channel })
          }
        })
      } catch (err) {
        console.error(err)
      }
    })

    this.on('request', (request) => {
      debug(request.initiator, ' -> ', request.target)
      request.forward() // forward all requests to connect
    })

    this.on('candidates', request => {
      try {
        const { channel } = request.discoveryData

        const peers = this.getPeers(channel)

        return request.forward({ peers: Array.from(peers.values()), channel })
      } catch (err) {
        console.error(err)
      }

      return request.forward({ peers: [] })
    })

    this.on('leave', request => {
      try {
        const { id: socketId } = request.socket

        const { channel } = request.discoveryData

        const peers = this.getPeers(channel)

        const id = peers.get(socketId)
        if (id && peers.delete(socketId)) {
          debug(`leave: ${id} channel: ${channel}`)
          this.emit('peer:leave', { socket: request.socket, id, channel })
        }
      } catch (err) {
        console.error(err)
      }

      return request.forward()
    })
  }
}

module.exports = (...args) => new SignalSwarmServer(...args)

module.exports.SignalSwarmServer = SignalSwarmServer
