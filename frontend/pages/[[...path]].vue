<template lang="pug">
#browser-view
  .top-sticky-rail(mb-8, z-5, sticky, top='[calc(60px+0.25rem)]')
    NCollapseTransition(:show='isShowTopStickyRail || !!searchInput')
      NCard(size='small')
        .flex(justify-between, gap-4, items-center, lt-sm='flex-col gap-2')
          //- display mode
          NButtonGroup(v-model:value='currentLayout', size='small')
            NTooltip(
              v-for='item in layoutOptions',
              :key='item.value',
              placement='bottom',
              :show-arrow='false',
              :keep-alive-on-hover='false'
            )
              template(#default) {{ item.tooltip || item.label }}
              template(#trigger)
                NButton(
                  @click='currentLayout = item.value',
                  :type='item.value === currentLayout ? "primary" : "default"'
                )
                  NIcon(v-if='item.icon'): Component(:is='item.icon')
                  span(lt-md='hidden', ml-2) {{ item.label }}
          //- file search
          .flex-1(lt-sm='w-full')
            NInput(
              w-full,
              size='small',
              :placeholder='`在 /${currentPath} 中搜索文件`',
              v-model:value='searchInput',
              clearable
            )
              template(#prefix): NIcon(mr-2): IconSearch
          //- dir status
          NText.file-count-info(depth='3')
            template(v-if='!searchInput') {{ curObjectCount.folders }} 个文件夹 / {{ curObjectCount.files }} 个文件
            template(v-if='searchInput')
              NIcon(mr-2): IconFilter
              | 搜索到 {{ filteredPayload.objects.length }} / 共 {{ curObjectCount.files }} 个文件
          //- file operations
          NButtonGroup(size='small', lt-md='hidden')
            NTooltip(
              v-for='(action, index) in pathActions',
              :key='index',
              placement='bottom',
              :show-arrow='false',
              :keep-alive-on-hover='false'
            )
              template(#default) {{ action.tooltip || action.label }}
              template(#trigger)
                NButton(
                  :type='action.type',
                  secondary,
                  :loading='action.loading',
                  :title='action.tooltip',
                  :render-icon='() => h(action.icon)',
                  @click='action.action'
                )
                  template(v-if='action.label') {{ action.label }}
    .top-sticky-rail-trigger(
      @click='isShowTopStickyRail = !isShowTopStickyRail',
      absolute,
      cursor-pointer,
      top='[calc(100%+1rem)]',
      left='50%',
      uno:translate='-50% -50%',
      p-x-10,
      p-y='2px',
      rounded-full,
      leading-0
    )
      NIcon(size='12'): component(:is='isShowTopStickyRail ? IconChevronCompactUp : IconChevronCompactDown')

  //- Alerts
  NAlert(v-if='bucket.checkIsRandomUploadDir(currentPath)', type='info', title='随机上传目录', closable, my-4) 
    | 这是一个随机上传目录。上传到此处的文件会使用随机名称保存。最终访问链接可在
    |
    NA(@click='isShowUploadHistory = true')
      NIcon(mr-1): IconHistory
      | 上传记录
    | 。
  NAlert(v-if='bucket.checkIsHiddenDir(currentPath)', type='warning', title='隐藏目录', closable, my-4)
    | 此隐藏目录供 FlareDrive 应用内部使用。
    | 强烈建议不要在此目录中上传或删除文件。

  //- file browser
  NSkeleton(v-if='!payload', height='200px')
  NSpin(v-else, :show='isLoading')
    BrowserListView(
      v-if='currentLayout === "list"',
      :payload='filteredPayload',
      @navigate='onNavigate',
      @delete='onDelete',
      @download='onDownload',
      @rename='onRename'
    )
    BrowserGalleryView(
      v-if='currentLayout === "gallery"',
      :payload='filteredPayload',
      @navigate='onNavigate',
      @delete='onDelete',
      @download='onDownload',
      @rename='onRename'
    )
    BrowserBookView(
      v-if='currentLayout === "book"',
      :payload='payload',
      @navigate='onNavigate',
      @delete='onDelete',
      @download='onDownload',
      @rename='onRename'
    )

  //- readme
  BrowserReadmeCard#readme(
    v-if='readmeItem && currentLayout !== "book"',
    :item='readmeItem',
    :content='readmeContent',
    my-4,
    @navigate='onNavigate'
  )

  //- drop zone
  .drop-zone-tips(
    v-if='isOverDropZone',
    fixed,
    top-0,
    left-0,
    z-index-100,
    bg='[rgba(100,100,100,0.75)]',
    w-full,
    h-full
  )
    .inline-block(absolute, top='50%', left='50%', uno:translate='-50%', text-center)
      NIcon(size=40): IconUpload
      NP Drop files here to upload

  //- preview modal
  BrowserPreviewModal(
    v-model:show='isShowPreview',
    :item='previewItem',
    @delete='onDelete',
    @download='onDownload',
    @rename='onRename'
  )

  //- upload history
  BrowserUploadHistory(
    v-model:show='isShowUploadHistory',
    :list='bucket.uploadHistory',
    @delete='onDelete',
    @download='onDownload',
    @rename='onRename',
    @navigate='onNavigate'
  )

  //- upload progress
  NCard(
    :content-style='{ padding: "0.5rem" }',
    size='small',
    fixed,
    left='50%',
    w-860px,
    max-w-90vw,
    translate-x='-50%',
    z-50,
    transition='all ease-in-out',
    :style='bucket.isUploading ? { bottom: "1rem", opacity: "1", transitionDuration: "0.25s" } : { bottom: "-10rem", opacity: "0", transitionDelay: "3s", transitionDuration: "0.75s" }'
  )
    UploadProgress

  //- floating action button
  NFloatButton(type='primary', menu-trigger='hover', position='fixed', bottom='3rem', right='2rem', z-2)
    NIcon: IconPlus
    template(#menu)
      NTooltip(
        v-for='(action, index) in pathActions',
        :key='index',
        placement='left',
        :show-arrow='false',
        :keep-alive-on-hover='false'
      )
        template(#default) {{ action.tooltip }}
        template(#trigger)
          NFloatButton(:type='action.type', @click='action.action')
            NSpin(v-if='action.loading', show, :size='16')
            NIcon(v-else): component(:is='action.icon')

  //- debug info
  details.dev-only.bg-dev.mt-6
    NP path: {{ currentPath }}
    pre {{ payload }}
</template>

<script setup lang="tsx">
import { type R2BucketListResponse } from '@/models/R2BucketClient'
import { FileHelper } from '@/utils/FileHelper'
import { MAX_STORAGE_BYTES } from '../../common/app-env'
import type { R2Object } from '@cloudflare/workers-types/2023-07-01'
import {
  IconBook,
  IconChevronCompactDown,
  IconChevronCompactUp,
  IconCloudBolt,
  IconCloudUpload,
  IconFilter,
  IconFolderPlus,
  IconHistory,
  IconLibraryPhoto,
  IconList,
  IconPlus,
  IconReload,
  IconSearch,
  IconUpload,
} from '@tabler/icons-vue'
import { NFormItem, NInput, NSkeleton, NSelect, useMessage, useModal } from 'naive-ui'
import type { Component } from 'vue'

definePage({
  name: '@browser',
})

// Async components
const BrowserReadmeCard = defineAsyncComponent(() => import('@/components/Browser/BrowserReadmeCard.vue'))
const BrowserPreviewModal = defineAsyncComponent(() => import('@/components/Browser/BrowserPreviewModal.vue'))
const BrowserUploadHistory = defineAsyncComponent(() => import('@/components/Browser/BrowserUploadHistory.vue'))
const UploadProgress = defineAsyncComponent(() => import('@/components/UploadProgress.vue'))

const route = useRoute()
const router = useRouter()
const lastRoute = useLocalStorage('flaredrive:last-route', '/')

onMounted(async () => {
  await nextTick()
  if (lastRoute.value && route.path === '/' && route.fullPath !== lastRoute.value) {
    router.replace(lastRoute.value)
  }
})
onBeforeRouteUpdate((to) => {
  if (to.name === '@browser') {
    lastRoute.value = to.fullPath
  }
})

const nmodal = useModal()
const nmessage = useMessage()

/** route path without leading slash */
const currentPath = computed(() => {
  const paramPath: string[] | string = (route.params as any).path || ''
  if (Array.isArray(paramPath)) {
    return paramPath.join('/')
  } else {
    return decodeURIComponent(paramPath)
  }
})

const currentLayout = useLocalStorage('flaredrive:current-layout', 'list')
const layoutOptions = ref<{ label: string; value: string; icon?: Component; tooltip?: string }[]>([
  { label: 'List', value: 'list', icon: IconList, tooltip: `Basic data list. Easy to organize files.` },
  {
    label: 'Gallery',
    value: 'gallery',
    icon: IconLibraryPhoto,
    tooltip: `Very good for folders with lots of pictures and movies.`,
  },
  {
    label: 'Book',
    value: 'book',
    icon: IconBook,
    tooltip: `Browse this folder as a book. Helpful when reading comics, mangas or novels.`,
  },
])
watch(currentLayout, (newLayout) => {
  window.scrollTo({
    top: 0,
    behavior: 'smooth',
  })
})

const isLoading = ref(false)
const payload = ref<R2BucketListResponse>()
const bucket = useBucketStore()
const curObjectCount = computed(() => {
  if (!payload.value) return { files: 0, folders: 0 }
  return {
    files: payload.value.objects.length,
    folders: payload.value.folders.length,
  }
})

watch(
  currentPath,
  (newPath) => {
    if (newPath && !newPath.endsWith('/')) {
      router.replace(`/${newPath}/`)
    } else if (newPath === '/') {
      router.replace('/')
    } else {
      loadFileList()
    }
  },
  { immediate: true }
)

async function loadFileList() {
  isLoading.value = true
  try {
    const { data } = await bucket.list(currentPath.value)
    payload.value = data
  // update used bytes after loading file list
  bucket.refreshUsedBytes(currentPath.value).catch(() => {})
  } catch (error) {
    console.error('Error fetching data:', error)
    payload.value = undefined
  } finally {
    isLoading.value = false
  }
}

const isShowTopStickyRail = useLocalStorage('flaredrive:top-sticky-rail/show', true)

const searchInput = ref('')
const filteredPayload = computed(() => {
  if (!payload.value) return payload.value!
  if (!searchInput.value) return payload.value!
  const searchStr = searchInput.value.toLowerCase()
  const filteredObjects = payload.value.objects.filter((item) => {
    return item.key?.toLowerCase().includes(searchStr)
  })
  return {
    ...payload.value,
    objects: filteredObjects,
    folders: [],
  }
})

const isShowPreview = ref(false)
const previewItem = ref<R2Object | undefined>()
function onNavigate(item: R2Object) {
  const path = item.key || ''
  if (path === '/' || path === '') {
    router.push('/')
  } else if (path === '../') {
    const parentPath = currentPath.value.split('/').slice(0, -2).join('/')
    router.push(`/${parentPath}/`)
  } else if (path.endsWith('/')) {
    router.push(`/${path}`)
  } else {
    previewItem.value = item
    isShowPreview.value = true
  }
}
async function onDelete(item: R2Object) {
  nmodal.create({
    title: '删除文件',
    type: 'error',
    preset: 'confirm',
    content: () => {
      return (
        <div>
          确定要删除 <code>{item.key.split('/').pop()}</code> 吗？
        </div>
      )
    },
    positiveText: '删除',
    negativeText: '保留文件',
    onPositiveClick() {
      bucket
        .deleteFile(item)
        .then(() => {
          nmessage.success('文件删除成功')
          payload.value?.objects.splice(payload.value.objects.indexOf(item), 1)
          isShowPreview.value = false
        })
        .catch((err) => {
          nmessage.error(`删除文件失败：${err}`)
        })
    },
  })
}
async function onDownload(item: R2Object) {
  const url = bucket.getCDNUrl(item)
  const a = document.createElement('a')
  a.href = url
  a.download = item.key.split('/').pop() || `FlareDrive_download_${Date.now()}`
  a.click()
  nmessage.success('开始下载')
}
async function onRename(item: R2Object) {
  const toPathInput = ref(item.key)
  nmodal.create({
    title: '重命名文件',
    preset: 'confirm',
    autoFocus: true,
    content: () => {
      return (
        <NFormItem label="新名称（含路径）">
          <NInput value={toPathInput.value} onUpdateValue={(e) => (toPathInput.value = e)} clearable />
        </NFormItem>
      )
    },
    positiveText: '确定',
    negativeText: '取消',
    onPositiveClick() {
      const toPath = toPathInput.value
      const fromFolder = item.key.split('/').slice(0, -1).join('/')
      const toFolder = toPath.split('/').slice(0, -1).join('/')
      if (toPath === item.key) {
        return
      }
      bucket
        .rename(item.key, toPath)
        .then(() => {
          nmessage.success('文件重命名成功')
          // @ts-ignore
          item.key = toPath
          // @ts-ignore
          item.uploaded = new Date().toISOString()
        })
        .catch((err) => {
          nmessage.error(`重命名失败：${err}`)
        })
    },
  })
}
async function handleCreateFolder() {
  const folderNameInput = ref('')
  nmodal.create({
    title: 'Create Folder',
    preset: 'confirm',
    autoFocus: true,
    content: () => {
      return (
        <NFormItem label="Folder Name">
          <NInput value={folderNameInput.value} onUpdateValue={(e) => (folderNameInput.value = e)} clearable>
            {{
              prefix: () => (
                <>
                  /
                  {currentPath.value.length > 12
                    ? currentPath.value.slice(0, 6) + '...' + currentPath.value.slice(-6)
                    : currentPath.value}
                </>
              ),
            }}
          </NInput>
        </NFormItem>
      )
    },
    positiveText: 'Create',
    negativeText: 'Cancel',
    onPositiveClick() {
      let folderName = folderNameInput.value.replace(/\/+$/, '')
      if (!folderName) {
        nmessage.error('Folder name cannot be empty')
        return false
      }
      if (folderName.startsWith('.') || folderName.startsWith('/')) {
        nmessage.error('Invalid folder name')
        return false
      }
      router.push(`/${currentPath.value}${folderName}/`)
    },
  })
}

async function attemptQueueOrHandle(key: string, file: File) {
  try {
    const { promise } = bucket.addToUploadQueue(key, file)
    promise.then((item) => {
      if (!item) {
        nmessage.error(`Failed to upload file ${file.name}`)
      }
    })
    return
  } catch (err: any) {
    // If unknown used bytes, refresh and retry once
    if (err.code === 'unknown_used') {
      await bucket.refreshUsedBytes(currentPath.value)
      try {
        const { promise } = bucket.addToUploadQueue(key, file)
        promise.then((item) => {
          if (!item) {
            nmessage.error(`Failed to upload file ${file.name}`)
          }
        })
        return
      } catch (e: any) {
        err = e
      }
    }
    if (err.code === 'exceed') {
      // show quota modal to let user choose replace / delete / cancel
      await showQuotaModal(file, key, err)
      return
    }
    nmessage.error(`上传失败：${err?.message || err}`)
  }
}

async function showQuotaModal(file: File, key: string, err: any) {
  const existing = payload.value?.objects?.find((o) => o.key === key)
  const selectOptions = (payload.value?.objects || []).map((o) => {
    const name = o.key.split('/').pop() || o.key
    const size = o.size || 0
    return { label: `${name} (${FileHelper.formatFileSize(size)})`, value: o.key }
  })
  return new Promise<void>((resolve) => {
    let selectedToDelete: string | null = selectOptions.length ? selectOptions[0].value : null
    const modal = nmodal.create({
      title: '空间不足',
      preset: 'confirm',
      content: () => {
        return (
          <div>
            <p>
              上传 <strong>{file.name}</strong> 会导致超出配额（已用 {bucket.usedBytes?.value ? FileHelper.formatFileSize(bucket.usedBytes.value) : '未知'} / {FileHelper.formatFileSize(MAX_STORAGE_BYTES)}）。请选择操作：
            </p>
            {selectOptions.length ? (
              <NFormItem label='从当前目录删除文件以释放空间'>
                <NSelect
                  options={selectOptions}
                  value={selectedToDelete}
                  onUpdateValue={(v: any) => (selectedToDelete = v)}
                />
              </NFormItem>
            ) : null}
          </div>
        )
      },
      positiveText: existing ? '替换同名文件' : '删除所选文件并上传',
      negativeText: '取消',
      onPositiveClick: async () => {
        try {
          if (existing) {
            await bucket.deleteFile(existing)
          } else if (selectedToDelete) {
            const item = payload.value?.objects.find((o) => o.key === selectedToDelete)
            if (item) {
              await bucket.deleteFile(item)
            }
          } else {
            return false
          }
          // refresh used bytes and file list then retry upload
          await bucket.refreshUsedBytes(currentPath.value)
          await loadFileList()
          try {
            const { promise } = bucket.addToUploadQueue(key, file)
            promise.then((item) => {
              if (!item) {
                nmessage.error(`Failed to upload file ${file.name}`)
              }
            })
            resolve()
            return true
          } catch (e: any) {
            nmessage.error(`重新上传失败：${e?.message || e}`)
            resolve()
            return true
          }
        } catch (e: any) {
          nmessage.error(`操作失败：${e?.message || e}`)
          resolve()
          return true
        }
      },
      onNegativeClick() {
        resolve()
      },
    })
  })
}

function handleUploadInput(files: FileList | File[] | null, prefix = currentPath.value) {
  if (!files || !files.length) {
    return
  }
  files = Array.isArray(files) ? files : Array.from(files)
  files = files?.filter((file) => {
    return !!file.name
  })
  nmessage.info(
    files.length > 1 || bucket.currentBatchTotal
      ? `已将 ${files.length} 个文件加入上传队列...`
      : `正在上传 ${files[0].name}...`
  )
  files.forEach((file) => {
    const fileName = file.name
    if (fileName) {
      const key = `${prefix.replace(/\/+/g, '/')}/${fileName}`
      attemptQueueOrHandle(key, file)
    }
  })
}
const { isOverDropZone } = useDropZone(document.body, {
  multiple: true,
  onDrop(files) {
    handleUploadInput(files)
  },
})
const fileDialog = useFileDialog({
  multiple: true,
  accept: '*',
})
let __markAsRandomMode = false
function createUploadModal(randomMode = false) {
  typeof randomMode === 'boolean' && (__markAsRandomMode = randomMode)
  fileDialog.reset()
  fileDialog.open()
}
fileDialog.onChange((files) => {
  handleUploadInput(files, __markAsRandomMode ? RANDOM_UPLOAD_DIR : currentPath.value)
})

// Reload file list when upload finished
watch(
  computed(() => bucket.isUploading),
  (newState, oldState) => {
    if (oldState && !newState) {
      loadFileList()
        if (bucket.currentBatchTotal > 1) {
        nmessage.success(`上传完成，共 ${bucket.currentBatchTotal} 个文件已上传`)
      } else {
        const item = bucket.uploadHistory[0]
        if (!item) return
        const { name } = FileHelper.getSimpleFileInfoByObject(item)
        nmessage.success(`上传成功：${name}`)
      }
    }
  }
)

const isShowUploadHistory = ref(false)

const pathActions = computed<
  {
    label: string
    type?: 'primary' | 'default'
    tooltip: string
    icon: Component
    loading?: boolean
    action: () => void
  }[]
>(() => {
  return [
    {
      label: '上传',
      type: 'primary',
      tooltip: '上传文件',
      icon: IconCloudUpload,
      action: () => createUploadModal(false),
    },
    {
      label: '',
      type: 'primary',
      tooltip: '随机名称上传',
      icon: IconCloudBolt,
      action: () => createUploadModal(true),
    },
    {
      label: '',
      tooltip: '创建文件夹',
      icon: IconFolderPlus,
      action: handleCreateFolder,
    },
    {
      label: '',
      tooltip: '上传记录',
      icon: IconHistory,
      action: () => (isShowUploadHistory.value = true),
    },
    {
      label: '',
      tooltip: '刷新文件列表',
      icon: IconReload,
      loading: isLoading.value,
      action: () => {
        loadFileList().then(() => nmessage.success('刷新成功'))
      },
    },
  ]
})

const cachedReadme = new Map<string, string>()
const readmeContent = ref('')
const readmeItem = computed(() => {
  return payload?.value?.objects?.find(
    (item) => item.key.toLowerCase() === 'readme.md' || item.key.toLowerCase().endsWith('/readme.md')
  )
})
watch(
  readmeItem,
  (item, prevItem) => {
    if (!item) {
      readmeContent.value = ''
      return
    }
    if (item.key === prevItem?.key) {
      return
    }
    readmeContent.value = ''
    if (cachedReadme.get(item.key)) {
      readmeContent.value = cachedReadme.get(item.key)!
    } else {
      fetchPlainText(item)
        .then((text) => {
          readmeContent.value = text
          cachedReadme.set(item.key, text)
        })
        .catch((error) => {
          console.error('Error fetching readme:', error)
        })
    }
  },
  { immediate: true }
)
const fetchPlainText = async (item: R2Object) => {
  if (!item) return ''
  const url = bucket.getCDNUrl(item)
  try {
    const response = await fetch(url)
    if (response.ok) {
      return response.text()
    } else {
      throw new Error('Network response was not ok')
    }
  } catch (error) {
    console.error('Error fetching readme:', error)
    return ''
  }
}
</script>

<style scoped lang="sass">
.top-sticky-rail .n-card, .top-sticky-rail-trigger
  backdrop-filter: blur(16px)
  background-color: rgba(245, 245, 245, 0.8)
  html.dark &
    background-color: rgba(23, 23, 23, 0.8)

.top-sticky-rail-trigger
  border: 1px solid rgba(0, 0, 0, 0.1)
  html.dark &
    border: 1px solid rgba(255, 255, 255, 0.125)
</style>
