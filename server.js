const debug = require('debug')('discovery-swarm-webrtc')
const SignalServer = require('./lib/signal-server')
const { toHex, toBuffer } = require('./lib/utils')

class SignalSwarmServer extends SignalServer {
  constructor ({ io }) {
    super(io)

    this.channels = new Map()

    this._initialize()
  }

  getPeers (channel) {
    const channelStr = toHex(channel)
    let peers = new Map()

    if (this.channels.has(toHex(channelStr))) {
      peers = this.channels.get(channelStr)
    } else {
      this.channels.set(channelStr, peers)
    }

    return peers
  }

  _initialize () {
    this.on('discover', (request) => {
      try {
        const { id: socketId } = request.socket
        const { id, channel } = request.discoveryData

        const peers = this.getPeers(channel)

        peers.set(socketId, id)

        debug(`discover: ${toHex(id)} channel: ${toHex(channel)}`)

        request.discover(id, { peers: Array.from(peers.values()), channel })
      } catch (err) {
        console.error(err)
      }
    })

    this.on('disconnect', (socket) => {
      try {
        const { id: socketId } = socket

        this.channels.forEach((peers, channelStr) => {
          const id = peers.get(socketId)
          if (id && peers.delete(socketId)) {
            debug(`disconnect: ${toHex(id)} channel: ${channelStr}`)
            this.emit('peer:leave', { socket, id, channel: toBuffer(channelStr) })
          }
        })
      } catch (err) {
        console.error(err)
      }
    })

    this.on('request', (request) => {
      debug(toHex(request.initiator), ' -> ', toHex(request.target))
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
          debug(`leave: ${toHex(id)} channel: ${toHex(channel)}`)
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
