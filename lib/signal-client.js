const SimpleSignalClient = require('simple-signal-client')
const crypto = require('crypto')

const TRANSACTION_TIMEOUT = 10 * 1000

const ERR_TRANSACTION_TIMEOUT = 'ERR_TRANSACTION_TIMEOUT'

class SignalError extends Error {
  constructor (message, code) {
    super(message)

    this.code = code || message
  }
}

class SignalClient extends SimpleSignalClient {
  static parseMetadataError (err) {
    if (err instanceof Error) {
      return err
    }

    if (!err.metadata || !err.metadata.code) {
      return new SignalError(JSON.stringify(err))
    }

    const { message, code } = err.metadata
    return new SignalError(message || code, code)
  }

  static createError (...args) {
    return new SignalError(...args)
  }

  constructor (socket, options = {}) {
    super(socket, options)

    this._transactions = new Map()

    ;['candidates', 'leave', 'info'].forEach(event => {
      this.socket.on(`simple-signal[${event}]`, this._onTransaction.bind(this, event))
    })
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

    const promise = new Promise((resolve, reject) => {
      this._transactions.set(transactionId, { resolve, reject })
      this.socket.emit(event, { transactionId, discoveryData })
    })

    const timer = setTimeout(() => {
      if (this._transactions.has(transactionId)) {
        const { reject } = this._transactions.get(transactionId)
        reject(SignalClient.createError(ERR_TRANSACTION_TIMEOUT))
      }
    }, TRANSACTION_TIMEOUT)

    return promise
      .then(data => {
        clearTimeout(timer)
        this._transactions.delete(transactionId)
        return data
      })
      .catch(err => {
        clearTimeout(timer)
        this._transactions.delete(transactionId)
        throw err
      })
  }

  _onTransaction (event, data) {
    if (data.transactionId) {
      if (this._transactions.has(data.transactionId)) {
        const { resolve } = this._transactions.get(data.transactionId)
        resolve(data.discoveryData)
      }
    } else {
      this.emit(event, data)
    }
  }
}

module.exports = SignalClient
