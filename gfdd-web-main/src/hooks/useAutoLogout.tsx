import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

// Hook to auto-logout after 30 minutes of token issuance
export const useAutoLogout = () => {
  const navigate = useNavigate();
  useEffect(() => {
    // Helper to clear token and redirect
    const logout = () => {
      localStorage.removeItem('access_token');
      localStorage.removeItem('access_token_timestamp');
      navigate('/login', { replace: true });
    };

    const checkInterval = 60 * 1000; // check every minute
    const maxAge =60* 60 * 1000; // 30 minutes in ms

    const intervalId = setInterval(() => {
      const timestamp = localStorage.getItem('access_token_timestamp');
      if (!timestamp) return;

      const tokenDate = new Date(parseInt(timestamp, 10));
      const now = new Date();
      if (now.getTime() - tokenDate.getTime() > maxAge) {
        logout();
      }
    }, checkInterval);

    const initialTs = localStorage.getItem('access_token_timestamp');
    if (initialTs) {
      const age = Date.now() - parseInt(initialTs, 10);
      if (age > maxAge) logout();
    }

    return () => clearInterval(intervalId);
  }, [navigate]);
};
