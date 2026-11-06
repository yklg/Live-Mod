// did-request-close 防自杀守卫（行为锚自 v3，平移至光圈式壳）
// 说明：'did-request-close' 未收录于 Electron 36 类型定义（运行时存在），
// 经窄化辅助挂载，保持 e.preventDefault() 语义；页面发起的载体关闭一律拒绝，用户点 X 不受影响。
export interface CloseRequestEvent {
  preventDefault: () => void
}

type ClosableWebContents = {
  on: (event: string, listener: (e: CloseRequestEvent) => void) => void
}

export function preventPageInitiatedClose(
  wc: Electron.WebContents,
  log: (msg: string) => void,
): void {
  ;(wc as unknown as ClosableWebContents).on('did-request-close', e => {
    log('已拒绝页面发起的关闭请求（保会话载体存活）')
    e.preventDefault()
  })
}
