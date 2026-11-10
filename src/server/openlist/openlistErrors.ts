/** Stable, Chinese-facing errors; raw diagnostics remain available separately. */
export function openlistError(error: any) {
  const raw = String(error?.message || error || '')
  const code = String(error?.code || error?.cause?.code || '')
  const text = code + ' ' + raw
  if (/401|unauthorized|password|密码/i.test(text)) return { code: 'auth', message: '登录失效，请检查账号或令牌', connection: true }
  if (/403|forbidden/i.test(text)) return { code: 'permission', message: '无访问权限，请检查账号和备份目录权限', connection: true }
  if (/timeout|timed out|abort|超时/i.test(text)) return { code: 'timeout', message: '请求超时，等待连接恢复后自动重试', connection: true }
  if (/502|503|504/.test(text)) return { code: 'upstream', message: 'OpenList 或上游存储暂时不可用，等待恢复后自动重试', connection: true }
  if (/fetch failed|ECONN|ENOTFOUND|EAI_AGAIN|socket|network|certificate|CERT_/i.test(text)) return { code: 'network', message: '无法连接 OpenList，请检查服务、网络或证书', connection: true }
  if (/ENOENT|ENOTDIR/i.test(text)) return { code: 'local_missing', message: '本地源文件不存在，请检查文件路径', connection: false }
  if (/EACCES|EPERM/i.test(text)) return { code: 'local_permission', message: '无法访问本地文件，请检查文件权限', connection: false }
  if (/404|不存在|not found/i.test(text)) return { code: 'missing', message: '云端文件或目录不存在，请重新检查', connection: false }
  if (/ENOSPC/i.test(text)) return { code: 'space', message: '本地磁盘空间不足，请清理后重试', connection: false }
  return { code: 'operation', message: /[一-鿿]/.test(raw) ? raw : '操作失败，请查看详情中的原始错误', connection: false }
}
