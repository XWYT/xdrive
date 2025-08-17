import { R2BucketClient } from '@/models/R2BucketClient'
import { FileHelper } from '@/utils/FileHelper'
import { MAX_STORAGE_BYTES } from '../../common/app-env'
import type { R2Object } from '@cloudflare/workers-types/2023-07-01'
import PQueue from 'p-queue'

export const useBucketStore = defineStore('bucket', () => {
  const client = new R2BucketClient()

  console.info('FlareDrive Env', {
    CDN_BASE_URL,
    FLARE_DRIVE_HIDDEN_KEY,
    RANDOM_UPLOAD_DIR,
    BATCH_UPLOAD_CONCURRENCY,
  })

  const checkIsRandomUploadDir = (key: string) => {
    return (
      RANDOM_UPLOAD_DIR &&
      RANDOM_UPLOAD_DIR.endsWith('/') &&
      RANDOM_UPLOAD_DIR !== '/' &&
      key.startsWith(RANDOM_UPLOAD_DIR)
    )
  }
  const checkIsHiddenDir = (key: string) => {
    return FLARE_DRIVE_HIDDEN_KEY && FLARE_DRIVE_HIDDEN_KEY !== '/' && key.startsWith(FLARE_DRIVE_HIDDEN_KEY + '/')
  }
  const checkIsHiddenFile = (key: string) => {
    return FLARE_DRIVE_HIDDEN_KEY && FLARE_DRIVE_HIDDEN_KEY !== '/' && key.endsWith(FLARE_DRIVE_HIDDEN_KEY)
  }

  const list = async (
    prefix: string,
    options?: { delimiter?: string; limit?: number; startAfter?: string },
    showHidden = false
  ) => {
    const response = await client.list(prefix, options)
    response.data.objects = response.data.objects.filter((item) => {
      if (showHidden) {
        return true
      }
      // Filter out hidden files
      if (item.key === FLARE_DRIVE_HIDDEN_KEY) {
        return false
      }
      return true
    })
    response.data.folders = response.data.folders.filter((folder) => {
      if (showHidden) {
        return true
      }
      // Filter out hidden folders
      if (folder.endsWith(`${FLARE_DRIVE_HIDDEN_KEY}/`)) {
        return false
      }
      return true
    })
    return response
  }
  const deleteFile = async (item: R2Object) => {
    await client.delete(item.key)
    // Remove from upload history
    uploadHistory.value = uploadHistory.value.filter((h) => item.key !== h.key)
    // delete thumbnail if needed
    if (item.customMetadata?.thumbnail) {
      client.delete(`${FLARE_DRIVE_HIDDEN_KEY}/thumbnails/${item.customMetadata.thumbnail}.png`).catch((e) => {
        // ignore error, this is not critical
        console.error('Error deleting thumbnail', item, e)
      })
    }
  }
  const rename = client.rename.bind(client)

  const createFolder = async (key: string) => {
    if (!key.endsWith('/')) {
      key += '/'
    }
    await client.upload(`${key}${FLARE_DRIVE_HIDDEN_KEY}`, '', {
      contentType: 'text/plain',
      metadata: {
        __flare_drive_internal__: '1',
      },
    })
  }

  const getCDNUrl = (payload: R2Object | string) => {
    if (!payload) {
      return ''
    }
    const filePath = typeof payload === 'string' ? payload : payload.key
    if (!filePath) {
      return ''
    }
    const url = new URL(filePath, CDN_BASE_URL)
    return url.toString()
  }
  const getThumbnailUrls = (
    item: R2Object,
    strict = false
  ): { square: string; small: string; medium: string; large: string } | null => {
    if (!item || item.key.endsWith('/')) {
      return null
    }
    if (
      !item.httpMetadata?.contentType?.startsWith('image/') &&
      !item.httpMetadata?.contentType?.startsWith('video/')
    ) {
      return null
    }
    if (strict && !item.customMetadata?.thumbnail) {
      return null
    }
    const makeCgiUrl = (size: number) => {
      const url = new URL(getCDNUrl(item.key))
      if (import.meta.env.DEV) {
        url.search = `thumbsize=${size}`
        return url.href
      }
      url.pathname = `/cdn-cgi/image/format=auto,fit=contain,width=${size},height=${size},onerror=redirect${url.pathname}`
      return url.href
    }
    const square = item.customMetadata?.thumbnail
      ? getCDNUrl(`${FLARE_DRIVE_HIDDEN_KEY}/thumbnails/${item.customMetadata.thumbnail}.png`)
      : ''
    if (item.httpMetadata?.contentType?.startsWith('video/')) {
      return square
        ? {
            square,
            small: square,
            medium: square,
            large: square,
          }
        : null
    }
    const small = makeCgiUrl(256)
    const medium = makeCgiUrl(400)
    const large = makeCgiUrl(800)
    return {
      square,
      small,
      medium,
      large,
    }
  }

  const UPLOAD_HISTORY_MAX = 1000
  const uploadHistory = useLocalStorage<R2Object[]>('flaredrive:upload-history', [])
  const addToUploadHistory = (item: R2Object) => {
    console.info('Upload history', item)
    uploadHistory.value = [item, ...uploadHistory.value.filter((i) => i.key !== item.key)]
    if (uploadHistory.value.length > UPLOAD_HISTORY_MAX) {
      uploadHistory.value = uploadHistory.value.slice(0, UPLOAD_HISTORY_MAX)
    }
  }

  const uploadOne = async (
    key: string,
    file: File,
    options?: { metadata?: Record<string, string>; onUploadProgress?: (ev: any) => void }
  ) => {
    const metadata = options?.metadata || {}
    const fileHash = await FileHelper.blobToSha1(file)
    const { ext } = FileHelper.getSimpleFileInfoByFile(file)
    const isMediaFile = FileHelper.checkIsMediaFile(file)

    if (isMediaFile) {
      try {
        const size = await FileHelper.getMediaFileNaturalSize(file)
        metadata['width'] = size.width.toString()
        metadata['height'] = size.height.toString()
      } catch (e) {
        console.warn('Error getting media file size', file, e)
      }
      try {
        const mediaMeta = await FileHelper.getMediaFileMetadata(file)
        await client.upload(`${FLARE_DRIVE_HIDDEN_KEY}/thumbnails/${fileHash}.png`, mediaMeta.thumbnail.blob, {
          metadata: {
            width: mediaMeta.thumbnail.width.toString(),
            height: mediaMeta.thumbnail.height.toString(),
          },
        })
        metadata['thumbnail'] = mediaMeta.sha1
        metadata['thumbnail_width'] = mediaMeta.thumbnail.width.toString()
        metadata['thumbnail_height'] = mediaMeta.thumbnail.height.toString()
      } catch (e) {
        console.error('Error generating thumbnail', file, e)
      }
    }
    if (checkIsRandomUploadDir(key)) {
      const hashFirst = fileHash.slice(0, 1)
      const hashSecond = fileHash.slice(0, 2)
      key = `${RANDOM_UPLOAD_DIR}${hashFirst}/${hashSecond}/${fileHash}${ext ? '.' + ext : ''}`
      metadata['original_name'] = file.name
    }

    console.info('Upload start', key, file, { metadata })
    const res = await client.upload(key, file, {
      metadata,
      onUploadProgress: options?.onUploadProgress,
    })
    console.info('Upload finish', key, file, res)
    if (res.data) {
      addToUploadHistory(res.data)
    }
    return res
  }

  // ---- Upload Queue ----
  const uploadQueue = new PQueue({
    concurrency: BATCH_UPLOAD_CONCURRENCY,
    interval: 500,
  })
  const isUploading = ref(false)
  const pendingUploadCount = ref(0)
  const currentBatchTotal = ref(0)
  const currentBatchFinished = ref(0)
  const currentBatchPercentage = computed(() => {
    if (currentBatchTotal.value === 0) {
      return 0
    }
    return Math.floor((currentBatchFinished.value / currentBatchTotal.value) * 100)
  })
  uploadQueue.on('add', () => {
    console.info('[queue] add')
    pendingUploadCount.value = uploadQueue.size
    // 添加队列时，如果不处于活跃状态，则重置当前批次的总数和完成数
    if (!isUploading.value) {
      currentBatchTotal.value = 0
      currentBatchFinished.value = 0
    }
    currentBatchTotal.value++
  })
  uploadQueue.on('active', () => {
    console.info('[queue] active')
    pendingUploadCount.value = uploadQueue.size
    isUploading.value = true
  })
  uploadQueue.on('idle', () => {
    console.info('[queue] idle')
    pendingUploadCount.value = 0
    isUploading.value = false
  })
  uploadQueue.on('next', () => {
    pendingUploadCount.value = uploadQueue.size
  })
  uploadQueue.on('completed', () => {
    pendingUploadCount.value = uploadQueue.size
    currentBatchFinished.value++
  })
  uploadQueue.on('error', (ctx) => {
    console.error('[queue] error', ctx)
    pendingUploadCount.value = uploadQueue.size
  })
  uploadQueue.on('empty', () => {
    pendingUploadCount.value = 0
  })

  const pendinUploadList = ref<{ key: string; abort?: () => void }[]>([])
  const uploadFailedList = ref<
    {
      key: string
      file: File
      error: Error
    }[]
  >([])

  // Per-file upload tracking for UI
  const uploadingFiles = ref<
    {
      key: string
      file: File
      previewUrl?: string | null
      progress: number
      uploadedBytes: number
      speedBytesPerSec?: number
  status: 'queued' | 'uploading' | 'finished' | 'error' | 'aborted' | 'paused'
      error?: any
  attempts?: number
  maxAttempts?: number
  retryDelayMs?: number
  retryTimer?: any
  nextRetryAt?: number
    }[]
  >([])

  // Storage quota tracking (in bytes)
  const usedBytes = ref<number | null>(null)

  const refreshUsedBytes = async (prefix = '/') => {
    // Aggregate object sizes under the bucket (may need pagination in backend)
    try {
      let total = 0
      let startAfter: string | undefined = undefined
      // loop to handle pagination if backend supports startAfter
      while (true) {
        const resp = await client.list(prefix, { startAfter, limit: 1000 })
        const objects: R2Object[] = resp.data.objects || []
        for (const obj of objects) {
          total += obj.size || 0
        }
        if (!resp.data.hasMore || !resp.data.moreAfter) {
          break
        }
        startAfter = resp.data.moreAfter || undefined
      }
      usedBytes.value = total
      return total
    } catch (e) {
      console.error('Failed to refresh used bytes', e)
      usedBytes.value = null
      return null
    }
  }

  const canUploadBytes = (size: number) => {
    // If usedBytes is null (unknown), be conservative and allow but recommend refresh
    if (typeof size !== 'number' || isNaN(size) || size < 0) {
      return { ok: false, reason: 'invalid_size' }
    }
    if (usedBytes.value === null) {
      return { ok: true, reason: 'unknown_used', usedBytes: null, max: MAX_STORAGE_BYTES }
    }
    const willBe = usedBytes.value + size
    if (willBe > MAX_STORAGE_BYTES) {
      return { ok: false, reason: 'exceed', usedBytes: usedBytes.value, max: MAX_STORAGE_BYTES }
    }
    return { ok: true, reason: 'ok', usedBytes: usedBytes.value, max: MAX_STORAGE_BYTES }
  }

  const addToUploadQueue = (key: string, file: File) => {
    // Check storage quota before queueing
    const check = canUploadBytes(file.size)
    if (!check.ok) {
      const err: any = new Error('Storage quota exceeded')
      err.code = check.reason
      err.usedBytes = check.usedBytes
      err.max = check.max
      throw err
    }
    const existing = pendinUploadList.value.find((item) => item.key === key)
    if (existing) {
      console.info('Upload already in queue', key, file)
      existing.abort?.()
    }
    const abortController = new AbortController()
    const abort = () => {
      console.info('Upload aborted', key, file)
      abortController.abort()
      pendinUploadList.value = pendinUploadList.value.filter((item) => item.key !== key)
      // mark uploadingFiles as aborted
      const idx = uploadingFiles.value.findIndex((u) => u.key === key)
      if (idx !== -1) {
          // revoke preview url if created
          if (uploadingFiles.value[idx].previewUrl) {
            try {
              URL.revokeObjectURL(uploadingFiles.value[idx].previewUrl as string)
            } catch (e) {
              // ignore
            }
          }
        uploadingFiles.value[idx].status = 'aborted'
        // clear any scheduled retry
        try {
          if (uploadingFiles.value[idx].retryTimer) clearTimeout(uploadingFiles.value[idx].retryTimer)
        } catch (e) {}
      }
    }
    pendinUploadList.value.push({
      key,
      abort,
    })

    // add or reuse per-file tracking
    let tracking = uploadingFiles.value.find((u) => u.key === key)
    if (!tracking) {
      const previewUrl = FileHelper.checkIsMediaFile(file) ? URL.createObjectURL(file) : null
      tracking = {
        key,
        file,
        previewUrl,
        progress: 0,
        uploadedBytes: 0,
        speedBytesPerSec: 0,
        status: 'queued',
        attempts: 0,
        maxAttempts: 3,
        retryDelayMs: 1000,
        retryTimer: null,
        nextRetryAt: 0,
      }
      uploadingFiles.value.push(tracking as any)
    } else {
      // if resuming, ensure status moves to queued without resetting attempts
      tracking.status = tracking.status === 'paused' ? 'queued' : tracking.status
      tracking.file = file
    }
    const makeHandler = (tracking: any, key: string, file: File, abortControllerLocal: AbortController) => {
      return async () => {
        if (abortControllerLocal.signal.aborted) {
          throw new Error('Upload aborted')
        }
        // find tracking item
        if (tracking) tracking.status = 'uploading'

        let lastLoaded = 0
        let lastTime = Date.now()

        const onUploadProgress = (ev: any) => {
          try {
            const loaded = ev.loaded || 0
            const total = ev.total || file.size || 0
            const now = Date.now()
            const dt = (now - lastTime) / 1000
            const dLoaded = loaded - lastLoaded
            const speed = dt > 0 ? Math.round(dLoaded / dt) : 0
            lastLoaded = loaded
            lastTime = now
            if (tracking) {
              tracking.uploadedBytes = loaded
              tracking.progress = total > 0 ? Math.floor((loaded / total) * 100) : 0
              tracking.speedBytesPerSec = speed
            }
          } catch (e) {
            console.warn('progress update failed', e)
          }
        }

        try {
          const { data } = await uploadOne(key, file, { metadata: {}, onUploadProgress })
          if (tracking) {
            tracking.progress = 100
            tracking.status = 'finished'
            // revoke preview url to free memory
            if (tracking.previewUrl) {
              try {
                URL.revokeObjectURL(tracking.previewUrl as string)
              } catch (e) {}
            }
          }
          return data
        } catch (error) {
          // handle retry logic below (rethrow to let outer handler manage)
          throw error
        }
      }
    }

    
    // Prepare tracking defaults (exists from above)
    if (tracking) {
      tracking.attempts = tracking.attempts || 0
      tracking.maxAttempts = tracking.maxAttempts || 3
      tracking.retryDelayMs = tracking.retryDelayMs || 1000
    }

    const makeAndEnqueue = (attemptController?: AbortController) => {
      const controller = attemptController || new AbortController()
      const localAbort = () => {
        controller.abort()
        pendinUploadList.value = pendinUploadList.value.filter((item) => item.key !== key)
      }
      // push current abort handle
      pendinUploadList.value.push({ key, abort: localAbort })
      const h = makeHandler(tracking, key, file, controller)
      const p = uploadQueue.add(async () => {
        try {
          return await h()
        } catch (err: any) {
          // handle retry/backoff
          if (tracking) {
            tracking.attempts = (tracking.attempts || 0) + 1
            tracking.error = err
            tracking.status = 'error'
          }
          const attempts = tracking?.attempts || 0
          const max = tracking?.maxAttempts || 3
          if (attempts < max && tracking?.status !== 'aborted' && tracking?.status !== 'paused') {
            const delay = (tracking?.retryDelayMs || 1000) * Math.pow(2, attempts - 1)
            if (tracking) {
              tracking.nextRetryAt = Date.now() + delay
              try {
                tracking.retryTimer = setTimeout(() => {
                  // before retrying, clear previous abort entries
                  pendinUploadList.value = pendinUploadList.value.filter((it) => it.key !== key)
                  // enqueue a new attempt
                  makeAndEnqueue()
                }, delay)
              } catch (e) {
                // ignore
              }
            }
            return
          }
          // if reached max attempts, record failure
          uploadFailedList.value.push({ key, file, error: err })
          throw err
        }
      }, { signal: controller.signal })
      return p
    }

    const promise = makeAndEnqueue(abortController)
    return {
      promise,
      abort,
    }
  }

  const abortUpload = (key: string) => {
    const found = pendinUploadList.value.find((p) => p.key === key)
    if (found) {
      found.abort?.()
      return true
    }
    // if not in pending list, try marking active upload as aborted
    const idx = uploadingFiles.value.findIndex((u) => u.key === key)
    if (idx !== -1) {
      // mark aborted and clear retry timers
      const it = uploadingFiles.value[idx]
      it.status = 'aborted'
      if (it.retryTimer) try { clearTimeout(it.retryTimer) } catch (e) {}
      if (it.previewUrl) {
        try { URL.revokeObjectURL(it.previewUrl as string) } catch (e) {}
      }
      return true
    }
    return false
  }

  const pauseUpload = (key: string) => {
    // pause by aborting active attempt and marking paused
    const found = pendinUploadList.value.find((p) => p.key === key)
    if (found) {
      found.abort?.()
    }
    const idx = uploadingFiles.value.findIndex((u) => u.key === key)
    if (idx !== -1) {
      const it = uploadingFiles.value[idx]
      it.status = 'paused'
      if (it.retryTimer) try { clearTimeout(it.retryTimer) } catch (e) {}
      return true
    }
    return false
  }

  const resumeUpload = (key: string) => {
    const idx = uploadingFiles.value.findIndex((u) => u.key === key)
    if (idx === -1) return false
    const it = uploadingFiles.value[idx]
    if (it.status !== 'paused' && it.status !== 'error') return false
    // reset status and enqueue a new attempt
    it.status = 'queued'
    it.error = undefined
    // clear any previous retry timer
    try {
      if (it.retryTimer) {
        clearTimeout(it.retryTimer)
        it.retryTimer = null
        it.nextRetryAt = 0
      }
    } catch (e) {}
    // schedule an immediate small-delay retry to resume smoothly
    try {
      setTimeout(() => {
        try {
          addToUploadQueue(it.key, it.file)
        } catch (e) {
          // ignore enqueue error here; caller can manually retry
        }
      }, 300)
      return true
    } catch (e) {
      return false
    }
  }

  const pauseAll = () => {
    // abort all pending attempts and mark items as paused
    pendinUploadList.value.forEach((p) => p.abort?.())
    pendinUploadList.value = []
    uploadingFiles.value.forEach((it) => {
      if (it.status === 'uploading' || it.status === 'queued') {
        it.status = 'paused'
        if (it.retryTimer) try { clearTimeout(it.retryTimer); it.retryTimer = null } catch (e) {}
      }
    })
  }

  const resumeAll = () => {
    // resume all paused or errored items by scheduling immediate retries
    uploadingFiles.value.forEach((it) => {
      if (it.status === 'paused' || it.status === 'error') {
        it.status = 'queued'
        it.error = undefined
        if (it.retryTimer) try { clearTimeout(it.retryTimer); it.retryTimer = null } catch (e) {}
        try {
          setTimeout(() => {
            try { addToUploadQueue(it.key, it.file) } catch (e) {}
          }, 300)
        } catch (e) {}
      }
    })
  }

  return {
    client,
    checkIsRandomUploadDir,
    checkIsHiddenDir,
    checkIsHiddenFile,
    list,
    createFolder,
    uploadOne,
    deleteFile,
    rename,
    getCDNUrl,
    getThumbnailUrls,
    uploadHistory,
    // uploadQueue: uploadQueue as PQueue, // 类型问题！！
    addToUploadQueue,
    isUploading,
    pendingUploadCount,
    currentBatchTotal,
    currentBatchFinished,
    currentBatchPercentage,
    uploadFailedList,
  uploadingFiles,
  abortUpload,
  pauseUpload,
  resumeUpload,
  usedBytes,
  refreshUsedBytes,
  canUploadBytes,
  }
})
