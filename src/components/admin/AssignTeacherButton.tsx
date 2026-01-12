import React, { useState } from 'react';
import AssignTeacherModal from './AssignTeacherModal';

interface Teacher {
    id: string;
    full_name: string | null;
    email: string;
}

interface AssignTeacherButtonProps {
    studentId: string;
    studentName: string;
    currentTeacherId?: string;
    teachers: Teacher[];
    buttonText: string;
    translations: {
        title: string;
        select: string;
        primary: string;
        assign: string;
        remove: string;
        success: string;
        current: string;
        none: string;
    };
}

export default function AssignTeacherButton({
    studentId,
    studentName,
    currentTeacherId,
    teachers,
    buttonText,
    translations,
}: AssignTeacherButtonProps) {
    const [isModalOpen, setIsModalOpen] = useState(false);

    return (
        <>
            <button
                onClick={() => setIsModalOpen(true)}
                className="w-full px-4 py-2 bg-[#006064] text-white font-bold uppercase text-sm border-2 border-[#006064] hover:bg-[#004d40] transition-colors"
            >
                {buttonText}
            </button>

            <AssignTeacherModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                studentId={studentId}
                studentName={studentName}
                currentTeacherId={currentTeacherId}
                teachers={teachers}
                translations={translations}
            />
        </>
    );
}
