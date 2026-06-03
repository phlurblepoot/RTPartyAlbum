import { useParams } from 'react-router-dom';

export default function UploadPage() {
  const { code } = useParams<{ code: string }>();
  return <div data-testid="upload-page">Upload page for {code}</div>;
}
