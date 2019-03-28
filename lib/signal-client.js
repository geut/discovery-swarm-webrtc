const SimpleSignalClient = require('simple-signal-client')
const crypto = require('crypto')

module.exports = class SignalClient extends SimpleSignalClient {
  constructor (socket) {
    super(socket)

    this.transactions = new Map()

    this.socket.on('simple-signal[candidates]', this._onCandidates.bind(this))
    this.socket.on('simple-signal[leave]', this._onLeave.bind(this))
  }

  async candidates (discoveryData = {}) {
    const transactionId = crypto.randomBytes(12).toString('hex')
    return new Promise(resolve => {
      this.transactions.set(transactionId, resolve)
      this.socket.emit('simple-signal[candidates]', { transactionId, discoveryData })
    })
  }

  async leave (discoveryData = {}) {
    const transactionId = crypto.randomBytes(12).toString('hex')
    return new Promise(resolve => {
      this.transactions.set(transactionId, resolve)
      this.socket.emit('simple-signal[leave]', { transactionId, discoveryData })
    })
  }

  _onCandidates (data) {
    const resolve = this.transactions.get(data.transactionId)
    this.transactions.delete(data.transactionId)
    resolve(data.discoveryData)
  }

  _onLeave (data) {
    const resolve = this.transactions.get(data.transactionId)
    this.transactions.delete(data.transactionId)
    resolve(data.discoveryData)
  }
}
