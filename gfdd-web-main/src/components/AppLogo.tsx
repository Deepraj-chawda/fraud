
import React from 'react';

type AppLogoProps = {
  theme?: 'light' | 'dark';
};

const AppLogo: React.FC<AppLogoProps> = ({ theme = 'light' }) => {
  const textColor = theme === 'dark' ? 'text-white' : 'text-blue-600';
  const logoFill = theme === 'dark' ? '#fff' : '#2563eb';
  const strokeColor = theme === 'dark' ? '#2563eb' : '#fff';

  return (
    <div className="flex items-center">
      {/* <svg
        width="36"
        height="36"
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="mr-2"
      >
        <rect width="32" height="32" rx="8" fill={logoFill} />
        <path
          d="M22 10H10V22H22V10Z"
          stroke={strokeColor}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M14 16C15.1046 16 16 15.1046 16 14C16 12.8954 15.1046 12 14 12C12.8954 12 12 12.8954 12 14C12 15.1046 12.8954 16 14 16Z"
          stroke={strokeColor}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M20 20L17.5 17.5"
          stroke={strokeColor}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className={`font-bold text-xl ${textColor}`}>ImageAI</span> */}
      <img
        src="/KPMGLogo.png"
        alt="Logo"
        className="h-24 w-24"
      />
    </div>
  );
};

export default AppLogo;
