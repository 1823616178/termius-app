import { createApp } from 'vue'
import App from './App.vue'
import { installAppForeground } from './services/app-foreground'
import './styles/fonts.css'
import './styles/global.scss'

installAppForeground()
createApp(App).mount('#app')
