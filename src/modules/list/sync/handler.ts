// 这个文件导出的方法将暴露给客户端调用，第一个参数固定为当前 socket 对象

// import { sendSyncActionList } from '@main/modules/winMain'
// import { SYNC_CLOSE_CODE } from '@/constants'
import { SYNC_CLOSE_CODE } from '@/constants'
import { getUserSpace } from '@/user'
// import { encryptMsg } from '@/utils/tools'

// let wss: LX.SocketServer | null
// let removeListener: (() => void) | null

// type listAction = 'list:action'

const handleListAction = async(userName: string, { action, data }: LX.Sync.List.ActionList) => {
  console.log('handleListAction', userName, action)
  switch (action) {
    case 'list_data_overwrite':
      await global.event_list.list_data_overwrite(userName, data, true)
      break
    case 'list_create':
      await global.event_list.list_create(userName, data.position, data.listInfos, true)
      break
    case 'list_remove':
      await global.event_list.list_remove(userName, data, true)
      break
    case 'list_update':
      await global.event_list.list_update(userName, data, true)
      break
    case 'list_update_position':
      await global.event_list.list_update_position(userName, data.position, data.ids, true)
      break
    case 'list_music_add':
      await global.event_list.list_music_add(userName, data.id, data.musicInfos, data.addMusicLocationType, true)
      break
    case 'list_music_move':
      await global.event_list.list_music_move(userName, data.fromId, data.toId, data.musicInfos, data.addMusicLocationType, true)
      break
    case 'list_music_remove':
      await global.event_list.list_music_remove(userName, data.listId, data.ids, true)
      break
    case 'list_music_update':
      await global.event_list.list_music_update(userName, data, true)
      break
    case 'list_music_update_position':
      await global.event_list.list_music_update_position(userName, data.listId, data.position, data.ids, true)
      break
    case 'list_music_overwrite':
      await global.event_list.list_music_overwrite(userName, data.listId, data.musicInfos, true)
      break
    case 'list_music_clear':
      await global.event_list.list_music_clear(userName, data, true)
      break
    default:
      throw new Error('unknown list sync action')
  }
  const userSpace = getUserSpace(userName)
  let key = userSpace.listManage.createSnapshot()
  return key
}

// const registerListActionEvent = () => {
//   const list_data_overwrite = async(listData: MakeOptional<LX.List.ListDataFull, 'tempList'>, isRemote: boolean = false) => {
//     if (isRemote) return
//     await sendListAction({ action: 'list_data_overwrite', data: listData })
//   }
//   const list_create = async(position: number, listInfos: LX.List.UserListInfo[], isRemote: boolean = false) => {
//     if (isRemote) return
//     await sendListAction({ action: 'list_create', data: { position, listInfos } })
//   }
//   const list_remove = async(ids: string[], isRemote: boolean = false) => {
//     if (isRemote) return
//     await sendListAction({ action: 'list_remove', data: ids })
//   }
//   const list_update = async(lists: LX.List.UserListInfo[], isRemote: boolean = false) => {
//     if (isRemote) return
//     await sendListAction({ action: 'list_update', data: lists })
//   }
//   const list_update_position = async(position: number, ids: string[], isRemote: boolean = false) => {
//     if (isRemote) return
//     await sendListAction({ action: 'list_update_position', data: { position, ids } })
//   }
//   const list_music_overwrite = async(listId: string, musicInfos: LX.Music.MusicInfo[], isRemote: boolean = false) => {
//     if (isRemote) return
//     await sendListAction({ action: 'list_music_overwrite', data: { listId, musicInfos } })
//   }
//   const list_music_add = async(id: string, musicInfos: LX.Music.MusicInfo[], addMusicLocationType: LX.AddMusicLocationType, isRemote: boolean = false) => {
//     if (isRemote) return
//     await sendListAction({ action: 'list_music_add', data: { id, musicInfos, addMusicLocationType } })
//   }
//   const list_music_move = async(fromId: string, toId: string, musicInfos: LX.Music.MusicInfo[], addMusicLocationType: LX.AddMusicLocationType, isRemote: boolean = false) => {
//     if (isRemote) return
//     await sendListAction({ action: 'list_music_move', data: { fromId, toId, musicInfos, addMusicLocationType } })
//   }
//   const list_music_remove = async(listId: string, ids: string[], isRemote: boolean = false) => {
//     if (isRemote) return
//     await sendListAction({ action: 'list_music_remove', data: { listId, ids } })
//   }
//   const list_music_update = async(musicInfos: LX.List.ListActionMusicUpdate, isRemote: boolean = false) => {
//     if (isRemote) return
//     await sendListAction({ action: 'list_music_update', data: musicInfos })
//   }
//   const list_music_clear = async(ids: string[], isRemote: boolean = false) => {
//     if (isRemote) return
//     await sendListAction({ action: 'list_music_clear', data: ids })
//   }
//   const list_music_update_position = async(listId: string, position: number, ids: string[], isRemote: boolean = false) => {
//     if (isRemote) return
//     await sendListAction({ action: 'list_music_update_position', data: { listId, position, ids } })
//   }
//   global.event_list.on('list_data_overwrite', list_data_overwrite)
//   global.event_list.on('list_create', list_create)
//   global.event_list.on('list_remove', list_remove)
//   global.event_list.on('list_update', list_update)
//   global.event_list.on('list_update_position', list_update_position)
//   global.event_list.on('list_music_overwrite', list_music_overwrite)
//   global.event_list.on('list_music_add', list_music_add)
//   global.event_list.on('list_music_move', list_music_move)
//   global.event_list.on('list_music_remove', list_music_remove)
//   global.event_list.on('list_music_update', list_music_update)
//   global.event_list.on('list_music_clear', list_music_clear)
//   global.event_list.on('list_music_update_position', list_music_update_position)
//   return () => {
//     global.event_list.off('list_data_overwrite', list_data_overwrite)
//     global.event_list.off('list_create', list_create)
//     global.event_list.off('list_remove', list_remove)
//     global.event_list.off('list_update', list_update)
//     global.event_list.off('list_update_position', list_update_position)
//     global.event_list.off('list_music_overwrite', list_music_overwrite)
//     global.event_list.off('list_music_add', list_music_add)
//     global.event_list.off('list_music_move', list_music_move)
//     global.event_list.off('list_music_remove', list_music_remove)
//     global.event_list.off('list_music_update', list_music_update)
//     global.event_list.off('list_music_clear', list_music_clear)
//     global.event_list.off('list_music_update_position', list_music_update_position)
//   }
// }

// const addMusic = (orderId, callback) => {
//   // ...
// }

// const broadcast = async(socket: LX.Socket, key: string, data: any, excludeIds: string[] = []) => {
//   if (!wss) return
//   const dataStr = JSON.stringify({ action: 'list:sync:action', data })
//   const userSpace = getUserSpace(socket.userInfo.name)
//   for (const client of wss.clients) {
//     if (excludeIds.includes(client.keyInfo.clientId) || !client.isReady || client.userInfo.name != socket.userInfo.name) continue
//     client.send(encryptMsg(client.keyInfo, dataStr), (err) => {
//       if (err) {
//         client.close(SYNC_CLOSE_CODE.failed)
//         return
//       }
//       userSpace.dataManage.updateDeviceSnapshotKey(client.keyInfo, key)
//     })
//   }
// }

// export const sendListAction = async(action: LX.Sync.List.ActionList) => {
//   console.log('sendListAction', action.action)
//   // io.sockets
//   await broadcast('list:sync:action', action)
// }

// export const registerListHandler = (_wss: LX.SocketServer, socket: LX.Socket) => {
//   if (!wss) {
//     wss = _wss
//     // removeListener = registerListActionEvent()
//   }

//   const userSpace = getUserSpace(socket.userInfo.name)
//   socket.onRemoteEvent('list:sync:action', (action) => {
//     if (!socket.isReady) return
//     // console.log(msg)
//     void handleListAction(socket.userInfo.name, action).then(key => {
//       if (!key) return
//       console.log(key)
//       userSpace.dataManage.updateDeviceSnapshotKey(socket.keyInfo, key)
//       void broadcast(socket, key, action, [socket.keyInfo.clientId])
//     })
//     // socket.broadcast.emit('list:action', { action: 'list_remove', data: { id: 'default', index: 0 } })
//   })

//   // socket.on('list:add', addMusic)
// }
// export const unregisterListHandler = () => {
//   wss = null

//   // if (removeListener) {
//   //   removeListener()
//   //   removeListener = null
//   // }
// }

const handler: LX.Sync.ServerSyncHandlerListActions<LX.Socket> = {
  async onListSyncAction(socket, action) {
    if (!socket.moduleReadys?.list) return
    const key = await handleListAction(socket.userInfo.name, action)
    console.log(key)
    const userSpace = getUserSpace(socket.userInfo.name)
    await userSpace.listManage.updateDeviceSnapshotKey(socket.keyInfo.clientId, key)
    const currentUserName = socket.userInfo.name
    const currentId = socket.keyInfo.clientId
    socket.broadcast((client) => {
      if (client.keyInfo.clientId == currentId || !client.moduleReadys?.list || client.userInfo.name != currentUserName) return
      void client.remoteQueueList.onListSyncAction(action).then(async() => {
        return userSpace.listManage.updateDeviceSnapshotKey(client.keyInfo.clientId, key)
      }).catch(err => {
      // TODO send status
        client.close(SYNC_CLOSE_CODE.failed)
        // client.moduleReadys.list = false
        console.log(err.message)
      })
    })
  },
}

export default handler
