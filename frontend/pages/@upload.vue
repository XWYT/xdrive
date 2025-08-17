<template lang="pug">
#upload-view
  NCard(title='上传文件')
    UploadForm
</template>

<script setup lang="ts">
definePage({
  name: '@upload-standalone',
})
</script>

<style scoped lang="sass"></style>
