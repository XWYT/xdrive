<template lang="pug">
NForm
  NFormItem(label='文件')
    NUpload(multiple, directory-dnd, :custom-request, @finish='onFinish', ref='uploaderRef')
      NUploadDragger
        div: NIcon(size='80'): IconUpload
        NP 点击或拖拽文件到此区域以上传
  NFormItem(label='前缀', v-if='!prefixReadonly')
    NInput(:placeholder='defaultPrefix', :default-value='defaultPrefix', v-model:value='formData.prefix', clearable)
  //- div
  //-   NButton(type='primary', block, @click='handleStart') Upload
  UploadProgress
</template>

<script setup lang="ts">
import type { R2Object } from '@cloudflare/workers-types/2023-07-01'
import { IconUpload } from '@tabler/icons-vue'
import { NFormItem, useMessage, useModal, type UploadCustomRequestOptions, type UploadFileInfo } from 'naive-ui'
import { MAX_STORAGE_BYTES } from '../../common/app-env'

const nmessage = useMessage()
const props = withDefaults(
  defineProps<{
    defaultPrefix?: string
    prefixReadonly?: boolean
  }>(),
  {
    defaultPrefix: '',
    prefixReadonly: false,
  }
)
const emit = defineEmits<{
  uploaded: [item: R2Object]
}>()
const formData = reactive({
  prefix: props.defaultPrefix,
})
const bucket = useBucketStore()

const nmodal = useModal()

const customRequest = async (payload: UploadCustomRequestOptions) => {
  console.info('upload', payload)
  payload.file.status = 'uploading'
  const timer = setInterval(() => {
    payload.file.percentage = Math.min(90, (payload.file.percentage || 0) + Math.random() * 10)
    if (payload.file.percentage >= 90) {
      clearInterval(timer)
    }
  }, 100)
  // Check quota before queueing
  const size = payload.file.file?.size || 0
  const check = bucket.canUploadBytes(size)
  if (!check.ok) {
    if (check.reason === 'unknown_used') {
      await bucket.refreshUsedBytes(formData.prefix || '/')
    }
    const afterCheck = bucket.canUploadBytes(size)
    if (!afterCheck.ok) {
      // show simple modal to cancel or refresh/delete
      await nmodal.info({
        title: '空间不足',
        content: `上传 ${payload.file.name} 会超出配额（已用 ${bucket.usedBytes?.value ? FileHelper.formatFileSize(bucket.usedBytes.value) : '未知'} / ${FileHelper.formatFileSize(MAX_STORAGE_BYTES)}），请先删除文件或调整上传。`,
      })
      payload.file.status = 'error'
      payload.file.percentage = 0
      payload.onError && payload.onError()
      clearInterval(timer)
      return
    }
  }

  bucket
    .addToUploadQueue(`${formData.prefix.replace(/\/$/, '')}/${payload.file.name}`, payload.file.file!)
    .promise.then((data) => {
      if (!data) {
        throw new Error('No data returned from upload')
      }
      payload.file.status = 'finished'
      payload.file.url = bucket.getCDNUrl(data)
      if (payload.file.file?.type.startsWith('image/')) {
        payload.file.thumbnailUrl = bucket.getCDNUrl(data)
      }
      payload.file.percentage = 100
      payload.onFinish()
      emit('uploaded', data)
      if (bucket.currentBatchTotal > 1) {
        if (bucket.currentBatchFinished === bucket.currentBatchTotal) {
          nmessage.success(`${bucket.currentBatchTotal} 个文件上传成功`)
        }
      } else {
        nmessage.success(`${payload.file.name} 上传成功`)
      }
    })
    .catch((err) => {
      nmessage.error('上传失败', err)
      payload.file.status = 'error'
      payload.file.percentage = 0
      payload.onError()
    })
    .finally(() => {
      clearInterval(timer)
    })
}
const uploaderRef = useTemplateRef('uploaderRef')
function handleStart() {
  uploaderRef.value!.submit()
}
function onFinish(options: { file: UploadFileInfo; event?: ProgressEvent }) {}
</script>

<style scoped lang="sass"></style>
