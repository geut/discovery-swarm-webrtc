const test = require('tape')
const crypto = require('crypto')
const createGraph = require('ngraph.graph')
const createGraphPath = require('ngraph.path')
const getPort = require('get-port')
const wrtc = require('wrtc')
const { SocketSignalWebsocketServer } = require('socket-signal-websocket')

const { addPeer } = require('./helpers/peers')

const MAX_NODES = 15
const TIMEOUT = 30 * 1000

const startServer = async () => {
  const server = require('http').createServer()

  const signal = new SocketSignalWebsocketServer({ server, requestTimeout: 10 * 1000 })

  const port = await getPort()

  return new Promise(resolve => server.listen(port, () => {
    resolve({ server, signal, url: `http://localhost:${port}` })
  }))
}

const close = async (server, graph) => {
  const wait = []
  graph.forEachNode(node => {
    wait.push(node.data.close())
  })
  await Promise.all(wait)
  return new Promise(resolve => server.close(resolve))
}

test(`graph connectivity for ${MAX_NODES} peers`, async (t) => {
  t.timeoutAfter(TIMEOUT)

  const graph = createGraph()
  const topic = crypto.randomBytes(32)
  const { server, url } = await startServer(t)

  t.comment(`discovery-signal-webrtc running on ${url}`)

  const swarms = [...Array(MAX_NODES).keys()].map(n => addPeer(
    graph,
    topic,
    {
      bootstrap: [url],
      simplePeer: {
        wrtc
      }
    }
  ))

  t.comment(`Testing connectivity for ${graph.getNodesCount()} peers`)

  const pathFinder = createGraphPath.aStar(graph)
  const fromId = swarms[0].id.toString('hex')
  let end = false

  t.equal(graph.getNodesCount(), MAX_NODES, `Should have ${MAX_NODES} nodes`)

  while (!end) {
    await new Promise(resolve => setTimeout(resolve, 5 * 1000))
    let found = true
    graph.forEachNode(function (node) {
      if (node.id === fromId) return
      found = found && (pathFinder.find(fromId, node.id).length > 0) && (node.data.getPeers().length > 0)
    })
    end = found
  }

  t.comment('Full network connection.')

  await close(server, graph)

  t.end()
})
