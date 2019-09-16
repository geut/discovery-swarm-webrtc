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

    this._destroyed = false
  }

  get connected () {
    return !!(this.socket && this.socket.connected)
  }

  async setSocket (socket) {
    this.socket = socket

    if (this.socket.destroyed) {
      await this.disconnect()
      throw new Error(new SwarmError('ERR_CONNECTION_CLOSED'))
    }

    if (this._destroyed) {
      if (!this.socket.destroyed) this.socket.destroy()
      throw new Error(new SwarmError('ERR_CONNECTION_CLOSED'))
    }

    this.socket.once('close', () => {
      this._handleClose()
    })
  }

  async disconnect (err) {
    if (this._destroyed) return
    this._destroyed = true

    if (!this.socket) {
      this._handleClose()
      return
    }

    return new Promise((resolve) => {
      if (this.socket.destroyed) {
        return resolve()
      }

      this.socket.once('close', () => {
        resolve()
      })

      this.socket.destroy(err)
    })
  }

  close () {
    this.disconnect().then(() => {}).catch(() => {})
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

  _handleClose () {
    this.emit('close')
    this.emit('end')
  }
}

module.exports = Peer
