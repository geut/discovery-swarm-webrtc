const SimpleSignalClient = require('simple-signal-client')
const crypto = require('crypto')

module.exports = class SignalClient extends SimpleSignalClient {
  constructor (socket) {
    super(socket)

    this.transactions = new Map()

    this.socket.on('simple-signal[candidates]', this._onTransaction.bind(this))
    this.socket.on('simple-signal[leave]', this._onTransaction.bind(this))
    this.socket.on('simple-signal[info]', this._onTransaction.bind(this))
  }

  async candidates (discoveryData = {}) {
    return this._emitTransaction('simple-signal[candidates]', discoveryData)
  }

  async leave (discoveryData = {}) {
    return this._emitTransaction('simple-signal[leave]', discoveryData)
  }

  async info (discoveryData = {}) {
    return this._emitTransaction('simple-signal[info]', discoveryData)
  }

  async _emitTransaction (event, discoveryData) {
    const transactionId = crypto.randomBytes(12).toString('hex')
    return new Promise(resolve => {
      this.transactions.set(transactionId, resolve)
      this.socket.emit(event, { transactionId, discoveryData })
    })
  }

  _onTransaction (data) {
    const resolve = this.transactions.get(data.transactionId)
    this.transactions.delete(data.transactionId)
    resolve(data.discoveryData)
  }
}
