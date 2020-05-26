const { createServer } = require('http')
const { SocketSignalWebsocketServer } = require('socket-signal-websocket')
const finished = require('tap-finished')

let server = null
let stream = null

module.exports = {
  async beforeAll () {
    server = createServer()

    const signal = new SocketSignalWebsocketServer({ server, requestTimeout: 10 * 1000 })
    signal.on('error', err => console.log('signal', err.message))

    return new Promise(resolve => server.listen(3001, () => resolve()))
  },
  afterAll () {
    if (!server) return
    server.close()
  },
  onExecute ({ options: { watch }, shutdown }) {
    if (stream) stream.end()
    stream = finished(function (results) {
      if (watch) return

      if (results.ok) {
        return shutdown(0)
      }
      shutdown(1)
    })
  },
  onMessage (msg) {
    stream.write(msg + '\n')
  }
}
