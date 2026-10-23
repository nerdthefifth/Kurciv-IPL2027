import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom';
import './index.css';
import { CareerProvider, ToastProvider } from './lib/context';
import { PrefsProvider } from './lib/prefs';
import { MetaProvider } from './lib/meta';
import { PlayerModalProvider } from './components/player';
import { Shell } from './components/Shell';
import { Loading } from './components/ui';
import { HomePage } from './pages/Home';
import { SavesPage } from './pages/Saves';
import { NewCareerPage } from './pages/NewCareer';
import { OverviewPage } from './pages/Overview';
import { SquadPage } from './pages/Squad';
import { TacticsPage } from './pages/Tactics';
import { MatchCentrePage } from './pages/MatchCentre';
import { FixturesPage } from './pages/Fixtures';
import { PostMatchPage } from './pages/PostMatch';
import { TablePage } from './pages/Table';
import { AuctionPage } from './pages/Auction';
import { TransfersPage } from './pages/Transfers';
import { YouthPage } from './pages/Youth';
import { TrainingPage } from './pages/Training';
import { MedicalPage } from './pages/Medical';
import { FinancesPage } from './pages/Finances';
import { ScoutingPage } from './pages/Scouting';
import { WorldPage } from './pages/World';
import { InternationalPage } from './pages/International';
import { HistoryPage } from './pages/History';
import { SettingsPage } from './pages/Settings';
import { ClubPage } from './pages/Club';
import { LabPage } from './pages/Lab';
import { DatabasePage } from './pages/Database';
import { BoardPage, ConversationsPage, FeedPage, InboxPage, NewsPage } from './pages/ClubWorld';
import {
  AuctionPrepPage, CalendarPage, ClubsDirectoryPage, ContinentalPage, InternationalHubPage, NationalTeamPage, PlayerDirectoryPage, PreseasonPage, PyramidPage,
  StadiumsPage, UniversePage,
} from './pages/Universe';

function CareerRoutes() {
  const { cid } = useParams();
  return (
    <CareerProvider id={cid!}>
      <PlayerModalProvider>
        <Shell>
          <Routes>
            <Route index element={<OverviewPage />} />
            <Route path="squad" element={<SquadPage />} />
            <Route path="tactics" element={<TacticsPage />} />
            <Route path="match" element={<MatchCentrePage />} />
            <Route path="fixtures" element={<FixturesPage />} />
            <Route path="fixtures/:fid" element={<PostMatchPage />} />
            <Route path="table" element={<TablePage />} />
            <Route path="auction" element={<AuctionPage />} />
            <Route path="transfers" element={<TransfersPage />} />
            <Route path="youth" element={<YouthPage />} />
            <Route path="training" element={<TrainingPage />} />
            <Route path="medical" element={<MedicalPage />} />
            <Route path="finances" element={<FinancesPage />} />
            <Route path="scouting" element={<ScoutingPage />} />
            <Route path="world" element={<WorldPage />} />
            <Route path="global" element={<InternationalPage />} />
            <Route path="international" element={<InternationalHubPage />} />
            <Route path="universe" element={<UniversePage />} />
            <Route path="pyramid" element={<PyramidPage />} />
            <Route path="clubs" element={<ClubsDirectoryPage />} />
            <Route path="continental" element={<ContinentalPage />} />
            <Route path="national-team" element={<NationalTeamPage />} />
            <Route path="preseason" element={<PreseasonPage />} />
            <Route path="players" element={<PlayerDirectoryPage />} />
            <Route path="auction-prep" element={<AuctionPrepPage />} />
            <Route path="stadiums" element={<StadiumsPage />} />
            <Route path="calendar" element={<CalendarPage />} />
            <Route path="history" element={<HistoryPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="club/:clubId" element={<ClubPage />} />
            <Route path="lab" element={<LabPage />} />
            <Route path="database" element={<DatabasePage />} />
            <Route path="inbox" element={<InboxPage />} />
            <Route path="conversations" element={<ConversationsPage />} />
            <Route path="board" element={<BoardPage />} />
            <Route path="news" element={<NewsPage />} />
            <Route path="feed" element={<FeedPage />} />
            <Route path="*" element={<Navigate to="" replace />} />
          </Routes>
        </Shell>
      </PlayerModalProvider>
    </CareerProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PrefsProvider>
      <ToastProvider>
        <MetaProvider fallback={<Loading label="Starting the local game engine…" />}>
          <BrowserRouter>
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/saves" element={<SavesPage />} />
              <Route path="/new" element={<NewCareerPage />} />
              <Route path="/c/:cid/*" element={<CareerRoutes />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </BrowserRouter>
        </MetaProvider>
      </ToastProvider>
    </PrefsProvider>
  </StrictMode>,
);
