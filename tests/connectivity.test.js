const crypto = require('crypto')
const createGraph = require('ngraph.graph')
const createGraphPath = require('ngraph.path')
const waitForExpect = require('wait-for-expect')
const getPort = require('get-port')
const wrtc = require('wrtc')

const swarm = require('..')
const debug = require('debug')
const log = debug('test:connectivity')
debug.enable('test:connectivity')

const MAX_NODES = 50
const MIN_LINKS = 56
const TIMEOUT = 30 * 1000

jest.setTimeout(TIMEOUT)

const getConnection = (sw, info) => {
  const connection = [sw.id.toString('hex'), info.id.toString('hex')]

  if (info.initiator) {
    return connection
  }

  return connection.reverse()
}

const createSwarm = (graph, topic, port) => {
  const sw = swarm({
    bootstrap: [`localhost:${port}`],
    simplePeer: {
      wrtc
    }
  })

  sw.on('connection', (_, info) => {
    const [ nodeOne, nodeTwo ] = getConnection(sw, info)
    if (!graph.hasLink(nodeOne, nodeTwo)) {
      graph.addLink(nodeOne, nodeTwo)
    }
  })

  sw.on('connection-closed', (_, info) => {
    const [ nodeOne, nodeTwo ] = getConnection(sw, info)
    graph.removeLink(nodeOne, nodeTwo)
  })

  sw.on('close', () => {
    graph.removeNode(sw.id.toString('hex'))
  })

  graph.addNode(sw.id.toString('hex'), sw)

  sw.join(topic)

  return sw
}

beforeAll(async () => {
  this.server = require('http').createServer()
  const io = require('socket.io')(this.server)

  require('../server')({ io })

  const port = await getPort()

  return new Promise(resolve => this.server.listen(port, () => {
    log('discovery-signal-webrtc running on %s', port)
    resolve()
  }))
})

afterAll(() => {
  return new Promise(resolve => this.server.close(resolve))
})

beforeEach(() => {
  this.graph = createGraph()
  this.topic = crypto.randomBytes(32)
})

afterEach(async () => {
  const wait = []
  this.graph.forEachNode(node => {
    wait.push(node.data.close())
  })
  return Promise.all(wait)
})

test(`graph connectivity for ${MAX_NODES} peers (minConnections=${MIN_LINKS})`, async () => {
  const swarms = [...Array(MAX_NODES).keys()].map(n => createSwarm(this.graph, this.topic, this.server.address().port))

  log(`Waiting for a minimum amount of ${MIN_LINKS} connections.`)

  await waitForExpect(() => {
    expect(this.graph.getLinksCount()).toBeGreaterThan(MIN_LINKS)
  }, Math.floor(TIMEOUT / 2), 1 * 1000)

  log(`Testing connectivity for ${this.graph.getNodesCount()} peers.`)

  const pathFinder = createGraphPath.aStar(this.graph)
  const fromId = swarms[0].id.toString('hex')
  this.graph.forEachNode(function (node) {
    if (node.id === fromId) return
    expect(pathFinder.find(fromId, node.id).length).toBeGreaterThan(0)
  })
})
