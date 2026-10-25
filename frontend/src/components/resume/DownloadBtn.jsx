import { FiDownload } from 'react-icons/fi'
import { useReactToPrint } from "react-to-print";
function DownloadBtn({ docRef }) {

    const handlePdf = useReactToPrint({
        contentRef: docRef,
        documentTitle: "FresherAIPDF"
    })

    const handleDownload = async () => {
        await handlePdf()


    }
    return (
        <button onClick={handleDownload} className='flex items-center gap-2 rounded-lg bg-black px-3 py-2 text-xs text-white'>
            <FiDownload />
            Download PDF

        </button>
    )
}

export default DownloadBtn
