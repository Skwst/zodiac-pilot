// injects a minimal script into the page to hint the user to reload the page when the panel is toggled

function inject(scriptPath: string) {
  const node = document.createElement('script')
  node.type = 'text/javascript'
  node.async = false
  node.src = chrome.runtime.getURL(scriptPath)

  if (document.documentElement.dataset.__zodiacPilotMonitorInjected) {
    // another installation of the extension has already injected itself
    // (this can happen when when loading unpacked extensions)
    return
  }
  document.documentElement.dataset.__zodiacPilotMonitorInjected = 'true'

  const parent = document.head || document.documentElement
  parent.insertBefore(node, parent.children[0])
  node.remove()
}

inject('build/monitor/injectedScript.js')

export {}