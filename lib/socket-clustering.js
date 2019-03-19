const assert = require('assert')

const _createSocket = function (url) {
  if (!this._socketIo) {
    this._socketIo = require('socket.io-client')
  }

  return this._socketIo(url)
}

class SocketClustering {
  constructor ({ urls, createSocket = _createSocket }) {
    assert(Array.isArray(urls) && urls.length > 0, 'You need to set a initial list of signaling urls.')

    this.urls = urls

    this.sockets = new Map()

    this.events = new Map()

    this.createSocket = createSocket

    this.urls.forEach(url => {
      const socket = this.createSocket(url)
      this.sockets.set(url, socket)
    })
  }

  get connected () {
    for (const socket of this.sockets.values()) {
      if (socket.connected) {
        return true
      }
    }

    return false
  }

  add (url) {
    const socket = this.createSocket(url)
    this.sockets.set(url, socket)
    this.events.forEach((cb, event) => {
      socket.on(event, cb)
    })
  }

  delete (url) {
    this.sockets.delete(url)
  }

  close () {
    this.sockets.forEach(socket => {
      socket.close()
    })
  }

  on (event, cb) {
    this.events.set(event, cb)
    this.sockets.forEach(socket => {
      socket.on(event, cb)
    })
  }

  emit (...args) {
    this.sockets.forEach(socket => {
      socket.emit(...args)
    })
  }
}

module.exports = (...args) => new SocketClustering(...args)
