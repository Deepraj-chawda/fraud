
import React from 'react';
import { Button } from '@/components/ui/button';
import { Upload } from 'lucide-react';

interface EmptyStateProps {  
  icon : string;
  title: string;
  description: string;
  className ?: string;
  onUploadClick: () => void;
}

const EmptyState: React.FC<EmptyStateProps> = ({ icon, title, description, onUploadClick }) => {
  return (
    <div className="h-full flex flex-col items-center justify-center p-8 bg-slate-50">
      <div className="w-20 h-20 rounded-full bg-slate-100 flex items-center justify-center mb-4 shadow-inner animate-pulse">
        <Upload className="h-10 w-10 text-primary/70" />
      </div>
      <h3 className="text-xl font-semibold text-slate-800 mb-2 animate-fade-in">No images uploaded</h3>
      <p className="text-slate-500 text-center max-w-md mb-6 animate-slide-in">
        Upload images to extract and analyze metadata. You can upload single or multiple images at once.
      </p>
      <Button 
        onClick={onUploadClick} 
        className="flex items-center gap-2 transition-transform hover:scale-105"
        size="lg"
      >
        <Upload className="h-4 w-4" /> Upload Images
      </Button>
    </div>
  );
};

export default EmptyState;
