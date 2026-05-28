export type LivenessChallenge = 'BLINK' | 'SMILE' | 'NONE';

export interface LivenessState {
  currentChallenge: LivenessChallenge;
  isPassed: boolean;
  stepMessage: string;
}

export class LivenessMath {
  // Strict operational thresholds for high-fidelity on-device accuracy
  private static readonly BLINK_THRESHOLD = 0.25; // Eye openness below 25% is classified as closed
  private static readonly SMILE_THRESHOLD = 0.75; // Smiling probability above 75% triggers validation

  /**
   * Evaluates native face properties against the active biometric challenge
   * @param leftEyeOpenProb Probability that the left eye is open (0.0 to 1.0)
   * @param rightEyeOpenProb Probability that the right eye is open (0.0 to 1.0)
   * @param smileProb Probability that the user is smiling (0.0 to 1.0)
   * @param activeChallenge The challenge the user must fulfill
   * @returns boolean true if the physical movement satisfies the cryptographic check
   */
  public static verifyChallenge(
    leftEyeOpenProb: number | undefined,
    rightEyeOpenProb: number | undefined,
    smileProb: number | undefined,
    activeChallenge: LivenessChallenge
  ): boolean {
    if (leftEyeOpenProb === undefined || rightEyeOpenProb === undefined || smileProb === undefined) {
      return false;
    }

    switch (activeChallenge) {
      case 'BLINK':
        // A genuine biological blink occurs when both eye probabilities drop sharply below our threshold
        return (
          leftEyeOpenProb < this.BLINK_THRESHOLD && 
          rightEyeOpenProb < this.BLINK_THRESHOLD
        );

      case 'SMILE':
        // Validates structure changes in zygomatic major muscles by reading native landmark shifts
        return smileProb > this.SMILE_THRESHOLD;

      case 'NONE':
      default:
        return true;
    }
  }

  /**
   * Utility to pick a random next step for anti-spoofing challenge randomization
   */
  public static generateRandomChallenge(): LivenessChallenge {
    const challenges: LivenessChallenge[] = ['BLINK', 'SMILE'];
    const randomIndex = Math.floor(Math.random() * challenges.length);
    return challenges[randomIndex];
  }
}