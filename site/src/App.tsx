import { Header } from './components/Header'
import { ExperimentalNotice } from './components/ExperimentalNotice'
import { Hero } from './components/Hero'
import { Features } from './components/Features'
import { Architecture } from './components/Architecture'
import { SyncHow } from './components/SyncHow'
import { QuickStart } from './components/QuickStart'
import { OpenApi } from './components/OpenApi'
import { Security } from './components/Security'
import { Faq } from './components/Faq'
import { Footer } from './components/Footer'

export default function App() {
  return (
    <div className="min-h-screen">
      <Header />
      <main>
        <ExperimentalNotice />
        <Hero />
        <Features />
        <Architecture />
        <SyncHow />
        <QuickStart />
        <OpenApi />
        <Security />
        <Faq />
      </main>
      <Footer />
    </div>
  )
}
