const { EventEmitter } = require('events')
const crypto = require('crypto')

const { toHex, SwarmError } = require('./utils')

class Peer extends EventEmitter {
  constructor (id, channel, opts = {}) {
    super()

    console.assert(Buffer.isBuffer(id))
    console.assert(Buffer.isBuffer(channel))

    const { socket, connectionId = crypto.randomBytes(32), initiator = true } = opts

    this.id = id
    this.channel = channel
    this.socket = socket
    this.connectionId = connectionId
    this.initiator = initiator

    this._close = false
  }

  get connected () {
    return !!(this.socket && this.socket.connected)
  }

  connect (socket) {
    if (this._close) {
      throw new Error(new SwarmError('ERR_CONNECTION_CLOSED'))
    }

    this.socket = socket
  }

  async disconnect (err) {
    this._close = true

    return new Promise((resolve) => {
      if (!this.socket || this.socket.destroyed) {
        return resolve()
      }

      this.socket.once('close', () => {
        resolve()
      })

      this.socket.destroy(err)
    })
  }

  getInfo () {
    return {
      id: this.id,
      channel: this.channel,
      initiator: this.initiator
    }
  }

  printInfo () {
    return {
      id: toHex(this.id),
      channel: toHex(this.channel),
      initiator: this.initiator
    }
  }
}

module.exports = Peer
