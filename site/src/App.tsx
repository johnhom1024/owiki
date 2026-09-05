import { Header } from './components/Header'
import { Hero } from './components/Hero'
import { Starfield } from './components/Starfield'
import { Wiki } from './components/Wiki'
import { Features } from './components/Features'
import { Architecture } from './components/Architecture'
import { SyncHow } from './components/SyncHow'
import { QuickStart } from './components/QuickStart'
import { Share } from './components/Share'
import { OpenApi } from './components/OpenApi'
import { Security } from './components/Security'
import { Faq } from './components/Faq'
import { Footer } from './components/Footer'

export default function App() {
  return (
    <div className="min-h-screen">
      <Starfield />
      <Header />
      <main>
        <Hero />
        <Wiki />
        <Features />
        <Architecture />
        <SyncHow />
        <QuickStart />
        <Share />
        <OpenApi />
        <Security />
        <Faq />
      </main>
      <Footer />
    </div>
  )
}
