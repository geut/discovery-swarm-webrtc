const nodesToArray = (graph, map) => {
  const nodes = []
  graph.forEachNode(node => {
    nodes.push(map ? map(node) : node)
  })
  return nodes
}

const linksToArray = (graph, map) => {
  const links = []
  graph.forEachLink(link => {
    links.push(map ? map(link) : link)
  })
  return links
}

module.exports = { nodesToArray, linksToArray }
