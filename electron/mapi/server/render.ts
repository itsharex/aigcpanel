import {ipcRenderer} from 'electron'
import {ServerInfo} from "./type";

const isSupport = async (serverInfo: ServerInfo) => {
    return ipcRenderer.invoke('server:isSupport', serverInfo)
}

const start = async (serverInfo: ServerInfo) => {
    return ipcRenderer.invoke('server:start', serverInfo)
}

const ping = async (serverInfo: ServerInfo) => {
    return ipcRenderer.invoke('server:ping', serverInfo)
}

const stop = async (serverInfo: ServerInfo) => {
    return ipcRenderer.invoke('server:stop', serverInfo)
}

const config = async (serverInfo: ServerInfo) => {
    return ipcRenderer.invoke('server:config', serverInfo)
}

const callFunction = async (serverInfo: ServerInfo, method: string, data: any) => {
    return ipcRenderer.invoke('server:callFunction', serverInfo, method, data)
}

const callFunctionWithException = async (serverInfo: ServerInfo, method: string, data: any) => {
    try {
        return ipcRenderer.invoke('server:callFunction', serverInfo, method, data)
    } catch (e) {
        return {
            code: -1,
            msg: e + '',
        }
    }
}

export default {
    isSupport,
    start,
    ping,
    stop,
    config,
    callFunction,
    callFunctionWithException,
}
