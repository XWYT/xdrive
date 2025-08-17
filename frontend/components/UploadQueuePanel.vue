<template lang="pug">
.n-upload-queue-panel(class="fixed bottom-6 right-6 z-50 w-full max-w-3xl")
  NCard(size='small')
    .panel-header.flex.justify-between.items-center.px-4.py-2
      .left.flex.items-center.gap-3
        NText strong {{ summaryText }}
        NText.footnote {{ uploadingFiles.length ? `${uploadingFiles.length} 个任务` : '空' }}
      .right
        NButton(size='small', tertiary, @click='isOpen = !isOpen')
          {{ isOpen ? '收起' : '展开' }}
    NCollapse(v-model:show='isOpen')
      .panel-body.p-2
        .controls.flex.justify-end.pb-2.items-center.gap-2
          NButton(size='tiny', tertiary, @click='() => { bucket.pauseAll(); message.info("全部已暂停") }')
            NIcon(class='icon-pause'): component(:is='IconPlayerPause')
            span.btn-label.ml-2 暂停所有
          NButton(size='tiny', tertiary, @click='() => { bucket.resumeAll(); message.success("全部恢复上传") }')
            NIcon(class='icon-play'): component(:is='IconPlayerPlay')
            span.btn-label.ml-2 恢复所有
          NButton(size='tiny', tertiary, @click='clearFinished')
            NIcon(class='icon-delete'): component(:is='IconTrash')
            span.btn-label.ml-2 清理已完成
        NList.divider
          NListItem(v-for='item in uploadingFiles' :key='item.key')
            .item-row.flex.items-center.gap-4.p-2.rounded-md(:class="[rowClass(item), { resuming: item._resuming }]")
              .preview.w-20.h-12.flex.items-center.justify-center.overflow-hidden.rounded
                template(v-if='item.previewUrl')
                  img(:src='item.previewUrl', alt='preview', style='width:100%; height:100%; object-fit:cover')
                template(v-else)
                  NIcon: component(:is="getIconForFile(item.file)")
              .meta.flex-1
                .top.flex.justify-between.items-start
                  .name.text-sm.truncate {{ item.file.name }}
                  .badge.text-xs.text-muted {{ statusLabel(item) }}
                .bottom.mt-1
                  .info.flex.items-center.justify-between
                    .left.text-xs.text-muted {{ formatSize(item.file.size) }}
                    .right.text-xs.text-muted
                      span {{ item.progress }}% &nbsp;
                      span(v-if='item.speedBytesPerSec') • {{ formatSpeed(item.speedBytesPerSec) }}
                      span(v-if='item.speedBytesPerSec') • ETA {{ formatETA(item) }}
                  NProgress(type='line', :percentage='item.progress', show-indicator=false)
              .actions.flex.flex-col.items-end.gap-1
                NTooltip(:content='"暂停"', placement='left')
                  NButton(size='tiny', tertiary, circle, v-if="item.status === 'uploading'", @click='() => { bucket.pauseUpload(item.key); message.info("已暂停") }')
                    NIcon(class='icon-pause'): component(:is='IconPlayerPause')
                NTooltip(:content='"继续"', placement='left')
                  NButton(size='tiny', tertiary, circle, v-if="item.status === 'paused'", @click='() => doResumeWithHighlight(item)')
                    NIcon(class='icon-play'): component(:is='IconPlayerPlay')
                NTooltip(:content='"取消"', placement='left')
                  NButton(size='tiny', tertiary, circle, v-if="item.status === 'queued'", @click='cancel(item)')
                    NIcon(class='icon-cancel'): component(:is='IconX')
                NTooltip(:content='"重试"', placement='left')
                  NButton(size='tiny', tertiary, circle, v-if="item.status === 'error'", @click='retry(item)')
                    NIcon(class='icon-retry'): component(:is='IconRefresh')
                NTooltip(:content='"删除"', placement='left')
                  NButton(size='tiny', tertiary, circle, v-if="item.status === 'finished' || item.status === 'aborted'", @click='remove(item)')
                    NIcon(class='icon-delete'): component(:is='IconTrash')
</template>

<script setup lang="ts">
import { NButton, NCard, NCollapse, NIcon, NList, NListItem, NProgress, NText, useMessage, NTooltip } from 'naive-ui'
import { useBucketStore } from '@/stores/bucket'
import { FileHelper } from '@/utils/FileHelper'
import { IconFileUnknown, IconPhoto, IconMovie, IconRefresh, IconTrash, IconX, IconPlayerPause, IconPlayerPlay } from '@tabler/icons-vue'

const bucket = useBucketStore()
const uploadingFiles = computed(() => bucket.uploadingFiles)
const isOpen = ref(true)
const message = useMessage()

const formatSize = (s: number) => FileHelper.formatFileSize(s)
const formatSpeed = (b: number) => {
  if (!b) return ''
  if (b > 1024 * 1024) return (b / (1024 * 1024)).toFixed(2) + ' MB/s'
  if (b > 1024) return (b / 1024).toFixed(1) + ' KB/s'
  return b + ' B/s'
}
const getIconForFile = (file: File) => {
  if (!file || !file.type) return IconFileUnknown
  if (file.type.startsWith('image/')) return IconPhoto
  if (file.type.startsWith('video/')) return IconMovie
  return IconFileUnknown
}

const statusLabel = (item: any) => {
  switch (item.status) {
    case 'queued':
      return '等待中'
    case 'uploading':
      return '上传中'
    case 'finished':
      return '已完成'
    case 'error':
      return '上传失败'
    case 'aborted':
      return '已取消'
    default:
      return item.status || ''
  }
}

const formatETA = (item: any) => {
  if (!item.speedBytesPerSec || !item.file || !item.uploadedBytes) return '--'
  const remain = Math.max(0, (item.file.size || 0) - item.uploadedBytes)
  if (remain <= 0) return '0s'
  const secs = Math.ceil(remain / item.speedBytesPerSec)
  if (secs >= 3600) return Math.floor(secs / 3600) + 'h'
  if (secs >= 60) return Math.floor(secs / 60) + 'm ' + (secs % 60) + 's'
  return secs + 's'
}

const cancel = (item: any) => {
  const ok = bucket.abortUpload(item.key)
  if (ok) message.success('已取消上传')
  else message.error('取消失败')
}

const retry = async (item: any) => {
  try {
    // re-add to queue
    await bucket.addToUploadQueue(item.key, item.file)
    message.success('已重新加入上传队列')
  } catch (e: any) {
    message.error(`重新上传失败：${e?.message || e}`)
  }
}

const doResumeWithHighlight = (item: any) => {
  const ok = bucket.resumeUpload(item.key)
  if (ok) {
    // apply resuming highlight class temporarily
    const idx = uploadingFiles.value.findIndex((i) => i.key === item.key)
    if (idx !== -1) {
      const it = uploadingFiles.value[idx]
      it._resuming = true
      setTimeout(() => { try { it._resuming = false } catch (e) {} }, 1200)
    }
    message.success('已恢复上传')
  } else {
    message.error('恢复失败')
  }
}

const remove = (item: any) => {
  // remove from uploadingFiles and revoke preview
  const idx = uploadingFiles.value.findIndex((i) => i.key === item.key)
  if (idx !== -1) {
    const it = uploadingFiles.value[idx]
    if (it.previewUrl) try { URL.revokeObjectURL(it.previewUrl) } catch (e) {}
    uploadingFiles.value.splice(idx, 1)
    message.info('已移除')
  }
}

const clearFinished = () => {
  const remain = uploadingFiles.value.filter((i) => i.status !== 'finished' && i.status !== 'aborted')
  // revoke previews of removed
  uploadingFiles.value.forEach((it) => {
    if (it.status === 'finished' || it.status === 'aborted') {
      if (it.previewUrl) try { URL.revokeObjectURL(it.previewUrl) } catch (e) {}
    }
  })
  uploadingFiles.value.splice(0, uploadingFiles.value.length, ...remain)
  message.success('已清理')
}

const rowClass = (item: any) => {
  if (item.status === 'error') return 'bg-error/10'
  if (item.status === 'uploading') return 'bg-primary/5'
  return ''
}

const summaryText = computed(() => {
  const total = uploadingFiles.value.length
  const active = uploadingFiles.value.filter((i) => ['uploading', 'queued'].includes(i.status)).length
  const finished = uploadingFiles.value.filter((i) => i.status === 'finished').length
  return `上传队列：${active} / ${total}（已完成 ${finished}）`
})
</script>

<style scoped lang="sass">
.n-upload-queue-panel
  transition: all .15s ease
  font-size: 13px

.panel-header
  border-bottom: 1px solid rgba(0,0,0,0.04)

.panel-body
  max-height: 46vh
  overflow: auto

.item-row
  padding: .35rem
  border-radius: .5rem
  align-items: center

.item-row .preview
  min-width: 80px
  max-width: 80px
  height: 48px

.badge
  color: #6b7280

.bg-error\/10
  background-color: rgba(239, 68, 68, 0.06)

.bg-primary\/5
  background-color: rgba(59, 130, 246, 0.04)

.resuming
  animation: resuming-highlight 1.2s ease-in-out

@keyframes resuming-highlight
  0%
    box-shadow: 0 0 0 0 rgba(59,130,246,0.32)
  70%
    box-shadow: 0 0 0 10px rgba(59,130,246,0)
  100%
    box-shadow: none

.controls
  padding-right: .25rem

.controls .btn-label
  display: inline-block

@media (max-width: 640px)
  .controls .btn-label
    display: none

.actions .n-button
  padding: .25rem

.actions .n-icon
  display: inline-flex
  align-items: center
  justify-content: center

.icon-pause .n-icon-inner svg,
.icon-play .n-icon-inner svg,
.icon-cancel .n-icon-inner svg,
.icon-retry .n-icon-inner svg,
.icon-delete .n-icon-inner svg
  width: 16px
  height: 16px

.icon-pause .n-icon-inner svg
  color: var(--n-icon-pause, var(--icon-pause))

.icon-play .n-icon-inner svg
  color: var(--n-icon-play, var(--icon-play))

.icon-cancel .n-icon-inner svg
  color: var(--n-icon-cancel, var(--icon-cancel))

.icon-retry .n-icon-inner svg
  color: var(--n-icon-retry, var(--icon-retry))

.icon-delete .n-icon-inner svg
  color: var(--n-icon-delete, var(--icon-delete))

</style>
