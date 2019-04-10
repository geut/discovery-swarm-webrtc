const debug = require('debug')('discovery-swarm-webrtc')
const SignalServer = require('./lib/signal-server')

class SignalSwarmServer extends SignalServer {
  constructor ({ io }) {
    super(io)

    this.channels = new Map()

    this._initialize()
  }

  _initialize () {
    this.on('discover', (request) => {
      const { id } = request.socket
      const { id: peerId, channel: channelName } = request.discoveryData

      let channel = new Map()

      if (this.channels.has(channelName)) {
        channel = this.channels.get(channelName)
      } else {
        this.channels.set(channelName, channel)
      }

      channel.set(id, peerId)

      debug(`discover: ${peerId} channel: ${channelName}`)

      request.discover(peerId, { peers: Array.from(channel.values()), channel: channelName })
    })

    this.on('disconnect', (socket) => {
      const { id } = socket
      this.channels.forEach((channel, channelName) => {
        const peerId = channel.get(id)
        if (peerId && channel.delete(id)) {
          debug(`disconnect: ${peerId} channel: ${channelName}`)
          this.emit('peer:leave', { id, channel: channelName, peerId })
        }
      })
    })

    this.on('request', (request) => {
      debug(request.initiator, ' -> ', request.target)
      request.forward() // forward all requests to connect
    })

    this.on('candidates', request => {
      const { channel: channelName } = request.discoveryData

      const channel = this.channels.get(channelName) || new Map()

      return request.forward({ peers: Array.from(channel.values()), channel: channelName })
    })

    this.on('leave', request => {
      const { id } = request.socket

      const { channel: channelName } = request.discoveryData

      if (!this.channels.has(channelName)) {
        return request.forward()
      }

      const channel = this.channels.get(channelName)

      const peerId = channel.get(id)
      if (peerId && channel.delete(id)) {
        debug(`leave: ${peerId} channel: ${channelName}`)
        this.emit('peer:leave', { id, channel: channelName, peerId })
      }

      return request.forward()
    })
  }
}

module.exports = (...args) => new SignalSwarmServer(...args)

module.exports.SignalSwarmServer = SignalSwarmServer
