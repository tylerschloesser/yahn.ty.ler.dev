import { createFileRoute } from '@tanstack/react-router'
import styles from './index.module.css'

export const Route = createFileRoute('/')({
  component: Index,
})

function Index() {
  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Top stories</h1>
      <p className={styles.lede}>The front-page feed lands in the next chunk.</p>
    </div>
  )
}
