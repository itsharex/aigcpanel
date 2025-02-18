import {net} from 'electron'
import {Client, handle_file} from "@gradio/client";
import {platformArch, platformName, platformUUID} from "../../lib/env";
import {Events} from "../event/main";
import {Apps} from "../app";
import {Files} from "../file/main";
import fs from 'node:fs'
import User, {UserApi} from "../user/main";
import {EncodeUtil, MemoryCacheUtil, MemoryMapCacheUtil} from "../../lib/util";
import {ServerContext, ServerFunctionDataType} from "./type";
import {UploadUtil} from "../../lib/upload";

const request = async (url, data?: {}, option?: {}) => {
    option = Object.assign({
        method: 'GET',
        timeout: 60 * 1000,
        headers: {
            'Content-Type': 'application/json'
        },
        responseType: 'json' as 'json'
    }, option)
    if (option['method'] === 'GET') {
        url += '?'
        for (let key in data) {
            url += `${key}=${data[key]}&`
        }
    }
    return new Promise((resolve, reject) => {
        const req = net.request({
            url,
            method: option['method'],
            headers: option['headers'],
        })
        req.on('response', (response) => {
            let body = ''
            response.on('data', (chunk) => {
                body += chunk.toString()
            })
            response.on('end', () => {
                if ('json' === option['responseType']) {
                    try {
                        resolve(JSON.parse(body))
                    } catch (e) {
                        resolve({code: -1, msg: `ResponseError: ${body}`})
                    }
                } else {
                    resolve(body)
                }
            })
        })
        req.on('error', (err) => {
            reject(err)
        })
        if (option['method'] === 'POST') {
            req.write(JSON.stringify(data))
        }
        req.end()
    })
}

const requestPost = async (url, data?: {}, option?: {}) => {
    option = Object.assign({
        method: 'POST',
    })
    return request(url, data, option)
}

const requestGet = async (url, data?: {}, option?: {}) => {
    option = Object.assign({
        method: 'GET',
    })
    return request(url, data, option)
}

const requestPostSuccess = async (url, data?: {}, option?: {}) => {
    const res = await requestPost(url, data, option)
    if (res['code'] === 0) {
        return res
    }
    throw new Error(res['msg'])
}

const requestUrlFileToLocal = async (url, path) => {
    return new Promise((resolve, reject) => {
        const req = net.request(url)
        req.on('response', (response) => {
            const file = fs.createWriteStream(path)
            // @ts-ignore
            response.pipe(file)
            file.on('finish', () => {
                file.close()
                resolve('x')
            })
        })
        req.on('error', (err) => {
            reject(err)
        })
        req.end()
    })
}

const requestEventSource = async (url: string, param: any, option?: {
    method?: 'POST' | 'GET',
    headers?: Record<string, string>,
    onMessage: (data: any) => void,
    onEnd?: () => void,
}) => {
    option = Object.assign({
        method: 'POST',
        headers: {},
        onMessage: (data: any) => {
            console.log('onMessage', data)
        },
        onEnd: () => {
            console.log('onEnd')
        }
    }, option)
    // return new Promise((resolve, reject) => {
    //     const req = net.request({
    //         url,
    //         method: option.method,
    //         headers: {
    //             'Content-Type': 'application/json',
    //             ...option.headers,
    //         },
    //     })
    //     req.on('response', (response) => {
    //         console.log('response', response)
    //         let buffer = ''
    //         response.on('data', (chunk) => {
    //             console.log('response.data', chunk)
    //             buffer += chunk.toString()
    //             const lines = buffer.split("\n")
    //             buffer = lines.pop()
    //             for (const line of lines) {
    //                 if (line.startsWith("data: ")) {
    //                     const data = line.slice(6)
    //                     if ('[END]' === data) {
    //                         option.onEnd()
    //                         return;
    //                     }
    //                     const eventData = line.slice(6).trim();
    //                     option.onMessage(EncodeUtil.base64Decode(eventData))
    //                 }
    //             }
    //         })
    //         response.on('end', () => {
    //             resolve(undefined)
    //         })
    //     })
    //     req.on('error', (err) => {
    //         reject(err)
    //     })
    //     req.end()
    // });
    const response = await net.fetch(url, {
        method: option.method,
        headers: {
            'Content-Type': 'application/json',
            ...option.headers,
        },
        body: JSON.stringify(param || {}),
    });
    if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
        const {done, value} = await reader.read();
        if (done) {
            break;
        }
        buffer += decoder.decode(value, {stream: true});
        const lines = buffer.split("\n");
        buffer = lines.pop()
        // console.log('fetchEventSource', JSON.stringify(buffer))
        for (const line of lines) {
            // console.log('line', JSON.stringify(line))
            if (line.startsWith("data: ")) {
                const data = line.slice(6)
                if ('[END]' === data) {
                    option.onEnd()
                    return;
                }
                const eventData = line.slice(6).trim();
                option.onMessage(EncodeUtil.base64Decode(eventData))
            }
        }
    }
}

const env = async () => {
    const result = {}
    result['AIGCPANEL_SERVER_API_TOKEN'] = await User.getApiToken()
    result['AIGCPANEL_SERVER_UUID'] = platformUUID()
    result['AIGCPANEL_SERVER_LAUNCHER_MODE'] = 'api'
    return result
}

const sleep = async (ms) => {
    return new Promise((resolve) => {
        setTimeout(resolve, ms)
    })
}

const launcherSubmitAndQuery = async (context: ServerContext, data: ServerFunctionDataType, option?: {
    timeout: number,
}): Promise<{
    result: {
        [key: string]: any,
    },
    endTime: number,
}> => {
    option = Object.assign({
        timeout: 24 * 3600,
    }, option)
    const submitRet = await requestPost(`${context.url()}submit`, data) as any
    // console.log('submitRet', JSON.stringify(submitRet))
    if (submitRet.code) {
        throw new Error(`submit ${submitRet.msg}`)
    }
    const launcherResult = {
        result: {} as {
            [key: string]: any,
        },
        endTime: null,
    }
    const totalWait = Math.ceil(option.timeout / 5)
    for (let i = 0; i < totalWait; i++) {
        if (i >= totalWait - 1) {
            throw new Error('timeout')
        }
        await sleep(5000)
        const queryRet = await requestPost(`${context.url()}query`, {
            token: submitRet.data.token
        }) as any
        // console.log('queryRet', JSON.stringify(queryRet))
        if (queryRet.code) {
            throw new Error(queryRet.msg)
        }
        let logs = queryRet.data.logs
        if (logs) {
            logs = EncodeUtil.base64Decode(logs)
            if (logs) {
                await Files.appendText(context.ServerInfo.logFile, logs)
                const resultMat = logs.match(new RegExp(`AigcPanelRunResult\\[${data.id}\\]\\[(.*?)\\]`))
                if (resultMat) {
                    const result = JSON.parse(EncodeUtil.base64Decode(resultMat[1]))
                    launcherResult.result = Object.assign(launcherResult.result, result)
                    context.send('taskResult', {id: data.id, result})
                }
            }
        }
        if (queryRet.data.status === 'success') {
            launcherResult.endTime = Date.now()
            await Files.appendText(context.ServerInfo.logFile, 'success')
            break
        }
    }
    return launcherResult
}

const launcherPrepareConfigJson = async (data: any) => {
    const configJson = await Files.temp('json')
    await Files.write(configJson, JSON.stringify(data), {isFullPath: true})
    return configJson
}

const launcherCloudSubmit = async (context: ServerContext, data: ServerFunctionDataType, option?: {
    result?: {
        taskId?: string,
    },
    uploadFileKeys?: []
}): Promise<void> => {
    // console.log('launcherCloudSubmitAndQuery.data', {data})
    option = Object.assign({
        result: {
            taskId: '',
        },
        uploadFileKeys: [],
    }, option)
    let taskId = option.result.taskId || ''
    if (!taskId) {
        const resCheck = await UserApi.post<{
            uploadType: string,
        }>('aigcpanel/task/check', data, {
            catchException: false
        })
        // console.log('resCheck', resCheck)
        if (resCheck.code) {
            throw resCheck.msg
        }
        if (resCheck.data.uploadType && option.uploadFileKeys && option.uploadFileKeys.length > 0 && data['modelConfig']) {
            for (let key of option.uploadFileKeys) {
                if (key in data['modelConfig']) {
                    const uploadRes = await UploadUtil.upload(resCheck.data.uploadType as any, data['modelConfig'][key])
                    // console.log('uploadRes', uploadRes)
                    if (uploadRes.success) {
                        data['modelConfig'][key] = uploadRes.url
                    }
                }
            }
        }
        const resSubmit = await UserApi.post<{
            taskId: string,
        }>('aigcpanel/task/submit', data, {
            catchException: false
        })
        if (resSubmit.code) {
            throw resSubmit.msg
        }
        taskId = resSubmit.data.taskId
        // console.log('resSubmit', resSubmit)
        context.send('taskResult', {id: data.id, result: {taskId}})
    }
}

const launcherCloudQuery = async (context: ServerContext, data: ServerFunctionDataType, option?: {
    result?: {
        taskId?: string,
    },
}): Promise<{
    status: 'process' | 'success',
    param: any,
    result: any,
    endTime: number,
}> => {
    // console.log('launcherCloudSubmitAndQuery.data', {data})
    option = Object.assign({
        result: {
            taskId: '',
        },
        timeout: 24 * 3600,
        uploadFileKeys: [],
    }, option)
    let taskId = option.result.taskId || ''
    if (!taskId) {
        throw new Error('taskId is empty')
    }
    const launcherResult = {
        status: 'process' as 'process' | 'success',
        param: {},
        result: {},
        endTime: 0,
    }
    const queryRet = await UserApi.post<{
        status: 'queue' | 'process' | 'success' | 'fail' | 'error',
        taskId: string,
        result: any,
    }>(`aigcpanel/task/query`, {
        taskId
    }) as any
    // console.log('queryRet', JSON.stringify(queryRet))
    if (queryRet.code) {
        throw new Error(queryRet.msg)
    }
    const oldStatus = MemoryMapCacheUtil.get('CloudTaskStatus', taskId)
    if (oldStatus !== queryRet.data.status) {
        if ('process' === queryRet.data.status) {
            context.send('taskRunning', {id: data.id})
        }
        MemoryMapCacheUtil.set('CloudTaskStatus', taskId, queryRet.data.status)
        context.send('taskStatus', {id: data.id, status: queryRet.data.status})
    }
    if ('success' === queryRet.data.status) {
        launcherResult.status = 'success'
        launcherResult.endTime = Date.now()
        launcherResult.result = queryRet.data.result
    } else if ('fail' === queryRet.data.status || 'error' === queryRet.data.status) {
        if (queryRet.data.result && queryRet.data.result.msg) {
            throw queryRet.data.result.msg
        }
        throw queryRet.data.status
    }
    return launcherResult
}

export default {
    GradioClient: Client,
    GradioHandleFile: handle_file,
    event: Events,
    file: Files,
    app: Apps,
    request,
    requestPost,
    requestGet,
    requestPostSuccess,
    requestUrlFileToLocal,
    requestEventSource,
    platformName: platformName(),
    platformArch: platformArch(),
    env,
    sleep,
    base64Encode: EncodeUtil.base64Encode,
    base64Decode: EncodeUtil.base64Decode,
    launcherSubmitAndQuery,
    launcherPrepareConfigJson,
    launcherCloudSubmit,
    launcherCloudQuery,
}
