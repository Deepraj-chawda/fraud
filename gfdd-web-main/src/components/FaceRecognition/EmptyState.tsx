
import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Users } from 'lucide-react';

const EmptyState: React.FC = () => {
  return (
    <Card className="mt-6 bg-white">
      <CardContent className="p-12 flex flex-col items-center justify-center text-center">
        <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center mb-6">
          <Users className="h-10 w-10 text-slate-400" />
        </div>
        <h3 className="text-xl font-medium mb-2">Face Recognition - Many to Many</h3>
        <p className="text-muted-foreground max-w-md">
          Please upload both Input and Comparison folders to begin face recognition.
          The system will analyze and match faces between the two sets of images.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-8 max-w-lg w-full">
          <div className="border rounded-lg p-4 bg-slate-50">
            <h4 className="font-medium mb-2">Input Folder</h4>
            <p className="text-sm text-muted-foreground">
              Contains source images that will be analyzed for face recognition.
            </p>
          </div>
          <div className="border rounded-lg p-4 bg-slate-50">
            <h4 className="font-medium mb-2">Comparison Folder</h4>
            <p className="text-sm text-muted-foreground">
              Contains images to compare against the source images.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default EmptyState;
