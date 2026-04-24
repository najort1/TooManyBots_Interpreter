import { Navigate, createBrowserRouter } from 'react-router';
import App from './App';
import { readLegacyDashboardPath } from './lib/dashboardRoutes';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <Navigate to={readLegacyDashboardPath()} replace />,
  },
  {
    path: '/analytics',
    element: <App />,
  },
  {
    path: '/surveys',
    element: <App />,
  },
  {
    path: '/surveys/:surveyId',
    element: <App />,
  },
  {
    path: '/observability',
    element: <App />,
  },
  {
    path: '/handoff',
    element: <App />,
  },
  {
    path: '/broadcast',
    element: <App />,
  },
  {
    path: '/sessions',
    element: <App />,
  },
  {
    path: '/settings',
    element: <App />,
  },
  {
    path: '/flows',
    element: <App />,
  },
  {
    path: '/db-maintenance',
    element: <App />,
  },
  {
    path: '/setup',
    element: <App />,
  },
  {
    path: '*',
    element: <Navigate to={readLegacyDashboardPath()} replace />,
  },
]);
