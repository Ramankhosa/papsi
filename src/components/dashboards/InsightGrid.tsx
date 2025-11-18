'use client'







import { useState, useEffect } from 'react'



import { useRouter } from 'next/navigation'



import { useAuth } from '@/lib/auth-context'







interface IdeaBankStats {



  totalIdeas: number



  publicIdeas: number



  reservedIdeas: number



  userReservations: number



}







interface NoveltySearchHistoryItem {



  id: string



  title: string



  status: string



  createdAt: string



  completedAt?: string



  results?: any



}







interface InsightGridProps {



  onCardHover?: (cardType: string, message: string) => void



}







export default function InsightGrid({ onCardHover }: InsightGridProps) {



  const { user } = useAuth()



  const router = useRouter()



  const [ideaStats, setIdeaStats] = useState<IdeaBankStats | null>(null)



  const [noveltyHistory, setNoveltyHistory] = useState<NoveltySearchHistoryItem[]>([])



  const [draftsCount, setDraftsCount] = useState<number>(0)



  const [projectsCount, setProjectsCount] = useState<number>(0)



  const [loading, setLoading] = useState(true)







  useEffect(() => {



    if (user) {



      fetchDashboardData()



    }



  }, [user])







  const fetchDashboardData = async () => {



    try {



      setLoading(true)







      // Fetch idea bank stats



      const ideaResponse = await fetch('/api/idea-bank/stats', {



        headers: {



          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`



        }



      })



      if (ideaResponse.ok) {



        const ideaData = await ideaResponse.json()



        setIdeaStats(ideaData.stats)



      }







      // Fetch novelty search history



      const noveltyResponse = await fetch('/api/novelty-search/history', {



        headers: {



          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`



        }



      })



      if (noveltyResponse.ok) {



        const noveltyData = await noveltyResponse.json()



        setNoveltyHistory(noveltyData.history || [])



      }







      // Fetch projects to count drafts (patents in draft status)



      const projectsResponse = await fetch('/api/projects', {



        headers: {



          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`



        }



      })



      if (projectsResponse.ok) {



        const projectsData = await projectsResponse.json()



        const projects = projectsData.projects || []







        // Count patents across all projects that are in draft status



        let totalDrafts = 0



        for (const project of projects) {



          if (project.patents) {



            totalDrafts += project.patents.filter((patent: any) =>



              patent.status === 'DRAFT' || patent.status === 'IN_PROGRESS'



            ).length



          }



        }



        setDraftsCount(totalDrafts)



        setProjectsCount(projects.length)



      }







    } catch (error) {



      console.error('Failed to fetch dashboard data:', error)



    } finally {



      setLoading(false)



    }



  }







  const getLatestNoveltyResult = () => {



    if (noveltyHistory.length === 0) return null







    const latest = noveltyHistory[0]



    const stage1Results = latest.results?.stage1



    const patentCount = stage1Results?.patentCount || 0







    return {



      title: latest.title,



      patentCount,



      completedAt: latest.completedAt



    }



  }







  const latestNovelty = getLatestNoveltyResult()







  const handleCardClick = (card: any) => {



    if (card.navigateTo) {



      router.push(card.navigateTo)



    }



  }







  const cards = [



    {



      id: 'projects',



      icon: '📁',



      title: 'Projects',



      value: projectsCount.toString(),



      description: `${projectsCount} project${projectsCount !== 1 ? 's' : ''} active`,



      topBorderColor: '#10B981',



      tooltip: 'Manage your patent projects and collaborations. Access drafts, collaborators, and project settings.',



      navigateTo: '/projects'



    },



    {



      id: 'ideas',



      icon: '💡',



      title: 'Idea Bank',



      value: ideaStats ? String(ideaStats.totalIdeas || 0) : '0',



      description: ideaStats ? (String(ideaStats.totalIdeas || 0) + ' ideas available') : 'Loading ideas...',



      topBorderColor: '#B4C6FF',



      tooltip: `Idea growth rate +20% this week. ${ideaStats?.publicIdeas || 0} public ideas available.`



    },



    {



      id: 'drafts',



      icon: '📜',



      title: 'Drafts in Progress',



      value: draftsCount.toString(),



      description: `${draftsCount} draft${draftsCount !== 1 ? 's' : ''} awaiting completion`,



      topBorderColor: '#F5D77C',



      tooltip: 'Resume your latest draft where you left off. Kisho can help complete it.'



    },



    {



      id: 'novelty',



      icon: '🔍',



      title: 'Novelty Scans',



      value: noveltyHistory.length.toString(),



      description: (latestNovelty ? `Last: "${latestNovelty.title.substring(0, 25)}..." - ${latestNovelty.patentCount} hits` : 'No scans completed yet'),



      topBorderColor: '#A8E2D5',



      tooltip: `Total novelty searches: ${noveltyHistory.length}. Latest completed ${latestNovelty?.completedAt ? new Date(latestNovelty.completedAt).toLocaleDateString() : 'recently'}.`



    }



  ]







  if (loading) {



    return (



      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">



        {[1, 2, 3, 4].map((i) => (



          <div key={i} className="bg-white border border-[#E5E7EB] rounded-xl p-4 shadow-sm animate-pulse">



            <div className="h-3 bg-gray-200 rounded w-3/4 mb-2"></div>



            <div className="h-4 bg-gray-200 rounded w-1/2 mb-3"></div>



            <div className="h-2 bg-gray-200 rounded w-full"></div>



          </div>



        ))}



      </div>



    )



  }







  return (



    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">



      {cards.map((card) => (



        <div



          key={card.id}



          className={`relative bg-white border border-[#E5E7EB] rounded-xl p-4 shadow-sm hover:shadow-md transition-all duration-300 hover:scale-[1.02] ${card.navigateTo ? 'cursor-pointer' : ''} group overflow-hidden`}



          style={{ borderTop: `3px solid ${card.topBorderColor}` }}



          onMouseEnter={() => onCardHover?.(card.id, card.tooltip)}



          onMouseLeave={() => onCardHover?.(card.id, '')}



          onClick={() => card.navigateTo && handleCardClick(card)}



        >



          <div className="relative z-10">



            <div className="flex items-center justify-between mb-3">



              <div className="w-8 h-8 bg-[#D9E2FF] rounded-full flex items-center justify-center text-[#4C5EFF] text-lg shadow-sm">



                {card.icon}



              </div>



              <div className="text-lg font-bold text-[#4C5EFF]" style={{ fontFamily: 'Inter, sans-serif', fontWeight: 600 }}>



                {card.value}



              </div>



            </div>







            <h3 className="text-sm font-semibold text-[#1E293B] mb-1 group-hover:text-[#0F172A] transition-colors" style={{ fontFamily: 'Inter, sans-serif', fontWeight: 500 }}>



              {card.title}



            </h3>







            <p className="text-xs text-[#64748B] group-hover:text-[#475569] transition-colors leading-tight" style={{ fontFamily: 'Source Sans Pro, sans-serif', fontWeight: 400 }}>



              {card.description}



            </p>



          </div>



        </div>



      ))}



    </div>



  )



}



















