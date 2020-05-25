const { createServer } = require('http')
const { SocketSignalWebsocketServer } = require('socket-signal-websocket')
const finished = require('tap-finished')

let server = null
let stream = null

module.exports = {
  async beforeAll ({ shutdown }) {
    server = createServer()

    const signal = new SocketSignalWebsocketServer({ server, requestTimeout: 10 * 1000 })
    signal.on('error', err => console.log('signal', err.message))

    stream = finished(function (results) {
      if (results.ok) {
        return shutdown(0)
      }
      shutdown(1)
    })

    return new Promise(resolve => server.listen(3001, () => resolve()))
  },
  afterAll () {
    if (!server) return
    server.close()
  },
  onMessage (msg) {
    stream.write(msg + '\n')
  }
}
